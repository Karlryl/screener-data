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
  // ACHTUNG (T562-M2): diese beiden Zusicherungen zaehlen DATEIWEIT und reichen NICHT —
  // ein zweiter Boden NEBEN dem Gate laesst sie gruen. Der tragende Check steht unten
  // unter "T562-M2"; diese hier bleiben als grobe Zusatzsicherung stehen.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'refresh-universe.js'), 'utf8');
  const aufrufe = (src.match(/if \(!inDiscoveryMcapBand\(mcap\)\) continue;/g) || []).length;
  assert.equal(aufrufe, 2, 'Predefined-Bucket- UND Custom-Exchange-Schleife muessen den Gate rufen');
  assert.ok(!/mcap\s*<\s*(1e9|1000000000|MIN_MCAP_CUSTOM)/.test(src),
    'kein Ingest-Gate darf am Zahlen-/Alt-Boden vorbei vergleichen');
});

// ── T562-M2 (Hard-Review Tag 562): der Verdrahtungs-Waechter zaehlte DATEIWEIT ──────
// BEFUND, mit Repro belegt: `aufrufe === 2` plus das dateiweite Verbot der drei Literale
// bleibt GRUEN, wenn NEBEN dem Gate ein zweiter, strengerer Boden in eine der beiden
// Ingest-Schleifen kommt ('if (mcap < 2e9) continue;'). Das ist exakt die Bugklasse,
// gegen die F-11 gebaut wurde: zwei Boeden an zwei Orten, und niemand haelt sie zusammen.
// Ein dateiweiter Zaehler kann das prinzipiell nicht sehen — er weiss nicht, WO die
// Treffer liegen, also nicht, ob eine Schleife zwei hat und eine keinen.
// Ab hier werden die beiden Schleifenkoerper ISOLIERT und JEDER EINZELN geprueft: genau
// EIN Band-Gate, KEIN weiterer mcap-Vergleich (generisch statt Literal-Liste). Und der
// Pruefer wird im selben Test mutiert — der gueltige Stand muss DURCHGEHEN, beide kaputten
// Staende muessen AUFFLIEGEN, sonst ist der Pruefer selbst falsch-gruen.
const SRC_RU = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'refresh-universe.js'), 'utf8');
const GATE_ZEILE = 'if (!inDiscoveryMcapBand(mcap)) continue;';
const INGEST_MARKER = 'for (const q of quotes) {';

// Schleifenkoerper = vom Marker bis zur schliessenden Klammer auf Schleifen-Einrueckung
// (6 Leerzeichen; alles Innere steht tiefer eingerueckt). Zeilenkommentare fliegen raus,
// sonst haelt eine auskommentierte Gate-Zeile den Pruefer gruen.
function ingestSchleifen(src) {
  return src.split(INGEST_MARKER).slice(1).map(rest => {
    const ende = rest.search(/\n {6}\}/);
    return (ende < 0 ? rest : rest.slice(0, ende)).replace(/\/\/[^\n]*/g, '');
  });
}
function verdrahtungsMaengel(src) {
  const maengel = [];
  const bloecke = ingestSchleifen(src);
  if (bloecke.length !== 2) maengel.push(bloecke.length + ' Ingest-Schleifen gefunden statt 2');
  bloecke.forEach((b, i) => {
    const gates = (b.match(/inDiscoveryMcapBand\(/g) || []).length;
    if (gates !== 1) maengel.push('Schleife ' + (i + 1) + ': ' + gates + ' Band-Gate-Aufrufe statt genau 1');
    if (!b.includes(GATE_ZEILE)) maengel.push('Schleife ' + (i + 1) + ': Gate fehlt in der verwerfenden Form');
    for (const t of b.match(/\bmcap\s*[<>]=?\s*[\w.]/g) || [])
      maengel.push('Schleife ' + (i + 1) + ': zweiter mcap-Vergleich neben dem Gate ("' + t.trim() + '")');
  });
  return maengel;
}

test('T562-M2: jede Ingest-Schleife EINZELN — genau ein Band-Gate, kein zweiter mcap-Vergleich', () => {
  assert.deepEqual(verdrahtungsMaengel(SRC_RU), [],
    'gueltiger Stand muss durchgehen — sonst prueft der Waechter etwas anderes als er soll');
});

test('T562-M2 Gegenprobe: Zweitboden NEBEN dem Gate fliegt auf (alter Waechter blieb gruen)', () => {
  const mutiert = SRC_RU.replace(GATE_ZEILE, 'if (mcap < 2e9) continue;\n        ' + GATE_ZEILE);
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0, 'ein stiller Zweitboden muss auffliegen');
  // Beleg, dass genau DAS der alte Waechter durchgelassen haette (der Befund selbst):
  assert.equal((mutiert.match(/if \(!inDiscoveryMcapBand\(mcap\)\) continue;/g) || []).length, 2,
    'alter Zaehler-Waechter: unveraendert 2 Treffer -> gruen');
  assert.ok(!/mcap\s*<\s*(1e9|1000000000|MIN_MCAP_CUSTOM)/.test(mutiert),
    'altes Boden-Verbot: kein Literal-Treffer -> gruen');
});

test('T562-M2 Gegenprobe: ein entferntes Gate fliegt auf — auch als Kommentar getarnt', () => {
  const mutiert = SRC_RU.replace(GATE_ZEILE, 'void 0;');
  assert.notEqual(mutiert, SRC_RU, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.ok(verdrahtungsMaengel(mutiert).length > 0, 'eine ungefilterte Ingest-Schleife muss auffliegen');
  // Tarnvariante aus dem Reviewer-Repro: das echte Gate faellt weg, die Zeichenkette taucht
  // dafuer als Kommentar auf -> ein dateiweiter Zaehler bleibt bei 2 und damit gruen.
  const getarnt = SRC_RU.replace(GATE_ZEILE, 'void 0;')   // echtes Gate raus
    .replace('const MIN_MCAP_DISCOVERY = 800e6;',         // Zeichenkette als Kommentar zurueck
      '// Beispielaufruf fuer neue Kanaele: ' + GATE_ZEILE + '\nconst MIN_MCAP_DISCOVERY = 800e6;');
  assert.equal((getarnt.match(/if \(!inDiscoveryMcapBand\(mcap\)\) continue;/g) || []).length, 2,
    'alter Zaehler-Waechter: 2 Treffer -> gruen, obwohl eine Schleife ungefiltert laeuft');
  assert.ok(verdrahtungsMaengel(getarnt).length > 0, 'die Kommentar-Tarnung muss auffliegen');
});

const YML = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
// T562-L1: ALLE Schritte, deren Name mit "Run Yahoo Pull" beginnt — nicht nur der erste.
const pullSchritte = (yml) => yml.split(/^ {6}- name: /m).filter(b => b.startsWith('Run Yahoo Pull'));

test('F-11: Discovery-Boden liegt nie UEBER dem Pull-Boden aus daily-pull.yml', () => {
  // DAS WAR DER BEFUND, nicht nur seine Folge: der Pull-Boden wurde 2026-06 auf $800M
  // gesenkt, der Entdeckungs-Boden blieb bei $1 Mrd — zwei Zahlen an zwei Orten, und
  // niemand hielt sie zusammen. Genau diese Richtung wird hier gepinnt.
  // Umgekehrt (Discovery UNTER Pull) ist erlaubt: dann schlaegt die Entdeckung Firmen
  // vor, die der Pull verwirft — Verschwendung, aber keine Luecke. Nur Discovery > Pull
  // erzeugt das tote Band, in dem eine Firma von KEINEM Kanal vorgeschlagen werden kann.
  // Am OBJEKT suchen, nicht dateiweit: nur der Block des "Run Yahoo Pull"-Schritts.
  // Dateiweites Greifen faende auch fremde MIN_MCAP_USD-Vorkommen und wuerde gruen
  // bleiben, wenn sich ausgerechnet der hier gemeinte Wert aendert.
  // T562-L1: filter statt find — find() nimmt blind den ERSTEN Treffer, ein zweiter
  // gleichnamiger Schritt haette den Test lautlos gegen die falsche Zahl vergleichen lassen.
  const bloecke = pullSchritte(YML);
  assert.equal(bloecke.length, 1,
    `${bloecke.length} Schritte beginnen mit "Run Yahoo Pull" — der Pull-Boden ist nicht mehr ` +
    'eindeutig ablesbar; dieser Test muesste dann sagen, WELCHER Schritt der echte Pull ist.');
  const block = bloecke[0];
  const m = block.match(/^\s*MIN_MCAP_USD:\s*'?(\d+)'?\s*$/m);
  assert.ok(m, 'MIN_MCAP_USD fehlt im "Run Yahoo Pull"-Block — Pull-Boden nicht mehr ablesbar');
  const pullBoden = Number(m[1]);
  assert.ok(ru.MIN_MCAP_DISCOVERY <= pullBoden,
    `Discovery-Boden $${ru.MIN_MCAP_DISCOVERY / 1e6}M liegt UEBER dem Pull-Boden $${pullBoden / 1e6}M — ` +
    'das Band dazwischen ist tot: der Pull wuerde diese Firmen nehmen, die Entdeckung schlaegt sie nie vor.');
});

test('T562-L1 Gegenprobe: ein zweiter "Run Yahoo Pull"-Schritt fliegt auf (find() nahm blind den ersten)', () => {
  // BEFUND Tag 562: `.find(b => b.startsWith('Run Yahoo Pull'))` nahm den ERSTEN Treffer.
  // Ein spaeter davor eingefuegter Schritt "Run Yahoo Pull (dry-run smoke)" mit eigenem
  // MIN_MCAP_USD haette den Kopplungstest gegen die falsche Zahl vergleichen lassen: gruen,
  // waehrend der echte Pull-Boden davondriftet. Genau die Lage, die F-11 erzeugt hat.
  const zweiterSchritt =
    "      - name: Run Yahoo Pull (dry-run smoke)\n" +
    "        env:\n" +
    "          MIN_MCAP_USD: '5000000000'\n" +
    "        run: node pull-yahoo.js --dry-run\n\n";
  const mutiert = YML.replace('      - name: Run Yahoo Pull (shard', zweiterSchritt + '      - name: Run Yahoo Pull (shard');
  assert.notEqual(mutiert, YML, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.equal(pullSchritte(mutiert).length, 2, 'die Eindeutigkeits-Zusicherung muss hier fallen');
  // und der ALTE Weg haette still den $5-Mrd-Schwindel-Block gelesen:
  const altBlock = mutiert.split(/^ {6}- name: /m).find(b => b.startsWith('Run Yahoo Pull'));
  assert.equal(Number(altBlock.match(/^\s*MIN_MCAP_USD:\s*'?(\d+)'?\s*$/m)[1]), 5000000000,
    'Beleg des Befunds: find() liest den falschen Schritt, ohne dass irgendetwas rot wird');
});

// ── T562-M1 (Hard-Review Tag 562): ein Kanal kann am Band-Gate LAUTLOS leerlaufen ──
// BEFUND, mit Repro belegt: toUsd() liefert null, sobald q.currency fehlt oder einen
// Yahoo-seitig geaenderten/unbekannten Code traegt (Schema-Bruch-Klasse) — dann verwirft
// inDiscoveryMcapBand() JEDE Zeile. Kein bestehender Waechter sieht das:
//   - Tag 510 misst nicht-leere BUCKETS, also Abgeholtes, nicht Behaltenes,
//   - die 0-Quotes-Warnung des Exchange-Kanals prueft totalQuotes (das ist > 0!),
//   - MIN_DISCOVERY_CANDIDATES kennt die beiden Yahoo-Kanaele gar nicht —
//     DISCOVERY_SOURCE_NAMES listet nur die 20 Adapter.
// Ergebnis: volle Buckets, 0 Kandidaten, Lauf gruen. Seit Tag 566 ist der Predefined-Kanal
// wieder scharf, die Lage ist also nicht mehr theoretisch.
const { toUsd } = require('../discovery/mcap-prefilter.js');
const FX_OHNE_SEK = { USD: 1, EUR: 1.1 };  // partielle Luecke, KEIN Ladefehler -> BH-041 greift nicht

test('T562-M1: Fixture — eine gesunde Boersenseite laeuft am Gate komplett leer', () => {
  const seite = [
    { symbol: 'ABC.ST', marketCap: 12e9, currency: 'SEK', quoteType: 'EQUITY' },   // FX-Luecke
    { symbol: 'DEF.ST', marketCap: 30e9, currency: 'SEK', quoteType: 'EQUITY' },   // FX-Luecke
    { symbol: 'GHI.ST', marketCap: 90e9, quoteType: 'EQUITY' },                    // currency fehlt ganz
  ];
  // die ECHTE Kette der beiden Ingest-Schleifen, nicht nachgebaut: toUsd() -> inDiscoveryMcapBand()
  const behalten = seite.filter(q => ru.inDiscoveryMcapBand(toUsd(q.marketCap, q.currency, FX_OHNE_SEK))).length;
  assert.equal(behalten, 0, 'Vorbedingung des Befunds: jede Zeile faellt still am Gate');
  assert.equal(ru.beideYahooKanaeleLeer(325, false, 0), false,
    'Beleg der Luecke: der Tag-510-Waechter schweigt, weil er Buckets misst statt Behaltenes');
  assert.ok(ru.kanalLeerlaufAlarm('Test-Kanal', seite.length, behalten, 2),
    'genau hier muss der neue Waechter feuern');
});

test('T562-M1: Waechter feuert NUR bei "abgeholt > 0 und nichts behalten"', () => {
  assert.equal(ru.kanalLeerlaufAlarm('K', 0, 0, 0), null,
    'gar nichts abgeholt ist der Fall der bestehenden Waechter (Tag 510 / BH-100), nicht dieser');
  assert.equal(ru.kanalLeerlaufAlarm('K', 5000, 1, 0), null,
    'eine einzige behaltene Zeile heisst: der Kanal lebt');
  assert.ok(ru.kanalLeerlaufAlarm('K', 5000, 0, 0), 'abgeholt und nichts behalten -> Alarm');
});

test('T562-M1: der Alarm trennt den Drop-Grund (FX-Luecke vs. ausserhalb Band)', () => {
  // Ohne getrennten Grund sagt die Meldung nur "nichts behalten" — die naechste Debug-Runde
  // faengt dann wieder bei null an. isUnpriceable() kann genau das unterscheiden.
  assert.match(ru.kanalLeerlaufAlarm('K', 100, 0, 100), /fx-rates\.json/);
  assert.doesNotMatch(ru.kanalLeerlaufAlarm('K', 100, 0, 0), /fx-rates\.json/);
  assert.ok(ru.kanalLeerlaufAlarm('K', 100, 0, 0).startsWith('::error::'),
    'muss als GitHub-Annotation sichtbar sein, sonst sieht Karl es nicht');
  assert.match(ru.kanalLeerlaufAlarm('Predefined-Screener-Kanal', 100, 0, 0), /Predefined-Screener-Kanal/,
    'die Meldung muss sagen, WELCHER Kanal leerlief');
});

test('T562-M1: beide Ingest-Schleifen trennen den Drop-Grund (isUnpriceable)', () => {
  // Am OBJEKT, nicht dateiweit: JEDE der beiden Schleifen muss den FX-Grund mitzaehlen,
  // sonst meldet der Alarm im Ernstfall immer "keine FX-Luecke" und schickt die naechste
  // Debug-Runde in die falsche Richtung.
  ingestSchleifen(SRC_RU).forEach((b, i) => {
    assert.match(b, /isUnpriceable\(q\.marketCap, q\.currency, _FX_RATES\)/,
      'Schleife ' + (i + 1) + ': zaehlt den FX-Drop-Grund nicht mit');
  });
});

test('T562-M1: BEIDE Yahoo-Kanaele sind an den Waechter verdrahtet', () => {
  // Ohne das waere die Funktion korrekt und die Luecke offen (dieselbe Falle wie T562-M2).
  // Kommentare vorher raus, damit eine blosse Erwaehnung im Fliesstext nicht gruen haelt.
  // ponytail: Zaehlung auf Namensebene — Deckel bekannt; eine Umbenennung faellt rot auf,
  // das ist die richtige Fehlerrichtung.
  const code = SRC_RU.replace(/\/\/[^\n]*/g, '');
  assert.equal((code.match(/kanalLeerlaufAlarm\(/g) || []).length, 3,
    'erwartet: 1 Definition + je 1 Aufruf im Predefined- und im Custom-Exchange-Kanal');
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
