// Waechter fuer das geoeffnete Entdeckungsband 800 Mio - 2 Mrd (Messung 19.08., PR #61).
//
// DER BEFUND, den dieser Test festnagelt — nicht seine Folge:
// Die Auslands-Entdeckung hat ZWEI Tore IN REIHE, nicht eines. Die Uebergabe kannte nur
// MCAP_PREFILTER_MIN_USD (2 Mrd) und schlug vor, es zu senken. Gemessen:
//   nur MCAP_PREFILTER_MIN_USD auf 800 Mio ->  592 Ticker (368 bleiben liegen)
//   nur TV_PRECUT_USD          auf 800 Mio ->    3 Ticker
//   BEIDE                                   ->  960 Ticker
// TV_PRECUT_USD schneidet fuer 31 TradingView-Laender VOR dem Prefilter. Wer nur eines
// der beiden senkt, glaubt das Band geoeffnet zu haben und hat es nicht — lautlos.
// Genau diese Halbheit ist der Fehlerfall, den dieser Test unmoeglich machen soll.
//
// Und er pinnt Karls Boden: KEINE Schwelle geht unter 800 Mio. Sein Entscheid 19.08.
// woertlich: "wenn es bei der SEC und anderen Gratis-Anbietern keine guten Daten unter
// 800 Mio gibt, dann bleibt es bei 800 Mio." Die Messung stuetzt ihn — die Score-Quote
// im Band 800 Mio-2 Mrd ist 90,6 %, unter 800 Mio faellt sie auf 19,5 %.
//
// Am OBJEKT suchen, nicht dateiweit: nur der Block des "Refresh Universe"-Schritts.
// Dateiweites Greifen faende auch fremde Vorkommen (z. B. in einem Kommentar oder einem
// zweiten Workflow-Schritt) und bliebe gruen, waehrend sich ausgerechnet der gemeinte
// Wert aendert. Dieselbe Lehre wie F-11/T562-L1 in refresh-universe.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const YML = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');

const KARLS_BODEN_USD = 800000000;

// Alle Schritte, deren Name mit "Refresh Universe" beginnt — nicht nur der erste.
const refreshSchritte = (yml) =>
  yml.split(/^ {6}- name: /m).filter((b) => b.startsWith('Refresh Universe'));

const leseZahl = (block, key) => {
  const m = block.match(new RegExp(`^\\s*${key}:\\s*'?(\\d+)'?\\s*$`, 'm'));
  return m ? Number(m[1]) : null;
};

test('Refresh Universe ist eindeutig ablesbar', () => {
  const bloecke = refreshSchritte(YML);
  assert.equal(bloecke.length, 1,
    `${bloecke.length} Schritte beginnen mit "Refresh Universe" — die Entdeckungs-Schwellen ` +
    'sind nicht mehr eindeutig ablesbar. Dieser Test muesste dann sagen, WELCHER der echte ist.');
});

test('BEIDE Entdeckungs-Tore stehen auf 800 Mio — eines allein waere wirkungslos', () => {
  const block = refreshSchritte(YML)[0];
  const prefilter = leseZahl(block, 'MCAP_PREFILTER_MIN_USD');
  const tvPrecut = leseZahl(block, 'TV_PRECUT_USD');

  assert.ok(prefilter !== null,
    'MCAP_PREFILTER_MIN_USD fehlt im "Refresh Universe"-Block — Tor 2 faellt auf seinen ' +
    'Code-Vorgabewert 2 Mrd zurueck, und zwar lautlos.');
  assert.ok(tvPrecut !== null,
    'TV_PRECUT_USD fehlt im "Refresh Universe"-Block — Tor 1 faellt auf 1,5 Mrd zurueck. ' +
    'Das Band gilt dann fuer 31 TradingView-Laender weiter als geschlossen, obwohl Tor 2 ' +
    'offen ist. Gemessene Folge: 368 Ticker bleiben liegen, ohne dass irgendetwas rot wird.');

  assert.equal(prefilter, KARLS_BODEN_USD,
    `MCAP_PREFILTER_MIN_USD steht auf ${prefilter} statt ${KARLS_BODEN_USD}.`);
  assert.equal(tvPrecut, KARLS_BODEN_USD,
    `TV_PRECUT_USD steht auf ${tvPrecut} statt ${KARLS_BODEN_USD}.`);

  // Die eigentliche Zusicherung: die beiden Tore duerfen NIE auseinanderlaufen.
  assert.equal(prefilter, tvPrecut,
    `Die beiden Entdeckungs-Tore stehen auf verschiedenen Werten (Tor 2 ${prefilter}, ` +
    `Tor 1 ${tvPrecut}). Sie wirken IN REIHE — das hoehere von beiden bestimmt, was ` +
    'ueberhaupt entdeckt wird. Eine Absenkung, die nur eines trifft, ist wirkungslos.');
});

test('Karls Boden: keine Entdeckungs-Schwelle geht unter 800 Mio', () => {
  const block = refreshSchritte(YML)[0];
  for (const key of ['MCAP_PREFILTER_MIN_USD', 'TV_PRECUT_USD']) {
    const wert = leseZahl(block, key);
    assert.ok(wert >= KARLS_BODEN_USD,
      `${key} steht auf ${wert} und damit UNTER Karls Boden von ${KARLS_BODEN_USD}. ` +
      'Sein Entscheid vom 19.08. haelt die Grenze bei 800 Mio; darunter faellt die ' +
      'gemessene Score-Quote von 90,6 % auf 19,5 %.');
  }
});

test('TV_SCAN_RANGE ist angehoben — sonst schneidet der Zeilendeckel Shenzhen ab', () => {
  const block = refreshSchritte(YML)[0];
  const range = leseZahl(block, 'TV_SCAN_RANGE');
  assert.ok(range !== null,
    'TV_SCAN_RANGE fehlt im "Refresh Universe"-Block. Bei 800 Mio meldet Shenzhen 3.008 ' +
    'Treffer gegen den Vorgabe-Deckel 2.500 — abgeschnitten wird am unteren Ende, also ' +
    'genau bei den Namen, wegen derer das Band ueberhaupt geoeffnet wurde.');
  assert.ok(range >= 3008,
    `TV_SCAN_RANGE steht auf ${range} und liegt damit unter den gemessenen 3.008 ` +
    'Shenzhen-Treffern bei 800 Mio — der Deckel schneidet wieder ab.');
});

// ── Gegenproben: der Test muss die realen Fehlerfaelle sehen koennen ──
// Ohne diese wuerde niemand merken, dass die Zusicherungen oben gar nicht greifen
// koennen. Betriebsregel: ein Waechter, der nie rot wird, ist kein Waechter.

test('Gegenprobe: die Halbheit "nur ein Tor gesenkt" fliegt auf', () => {
  // GENAU der Fehlerfall, den die Uebergabe vorgeschlagen haette. Werte, die sich
  // NACHWEISLICH unterscheiden — sonst kann die Probe den Unterschied nicht zeigen.
  const halb = YML.replace(/^(\s*)TV_PRECUT_USD:\s*'800000000'\s*$/m, "$1TV_PRECUT_USD: '1500000000'");
  assert.notEqual(halb, YML, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  const block = refreshSchritte(halb)[0];
  assert.equal(leseZahl(block, 'MCAP_PREFILTER_MIN_USD'), 800000000);
  assert.equal(leseZahl(block, 'TV_PRECUT_USD'), 1500000000);
  assert.notEqual(
    leseZahl(block, 'MCAP_PREFILTER_MIN_USD'), leseZahl(block, 'TV_PRECUT_USD'),
    'die Gleichheits-Zusicherung muss bei halber Absenkung fallen');
});

test('Gegenprobe: ein geloeschtes Tor fliegt auf, statt still auf den Code-Vorgabewert zu fallen', () => {
  const ohne = YML.replace(/^\s*MCAP_PREFILTER_MIN_USD:\s*'800000000'\s*\n/m, '');
  assert.notEqual(ohne, YML, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.equal(leseZahl(refreshSchritte(ohne)[0], 'MCAP_PREFILTER_MIN_USD'), null,
    'ein entferntes Tor muss als fehlend erkennbar sein — im Lauf faellt es sonst ' +
    'lautlos auf 2 Mrd zurueck, und niemand erfaehrt es');
});

test('Gegenprobe: ein zweiter "Refresh Universe"-Schritt fliegt auf', () => {
  // Lehre aus T562-L1: ein spaeter davor eingefuegter gleichnamiger Schritt haette den
  // Test gegen die falschen Zahlen vergleichen lassen — gruen, waehrend die echten
  // Schwellen davondriften.
  const zweiter =
    "      - name: Refresh Universe (dry-run smoke)\n" +
    "        env:\n" +
    "          MCAP_PREFILTER_MIN_USD: '9000000000'\n" +
    "        run: node refresh-universe.js --dry-run\n\n";
  const mutiert = YML.replace('      - name: Refresh Universe\n', zweiter + '      - name: Refresh Universe\n');
  assert.notEqual(mutiert, YML, 'Mutation griff nicht — dann prueft die Gegenprobe nichts');
  assert.equal(refreshSchritte(mutiert).length, 2, 'die Eindeutigkeits-Zusicherung muss hier fallen');
  // Beleg, dass der naive Weg still die falsche Zahl liest:
  const naiv = mutiert.split(/^ {6}- name: /m).find((b) => b.startsWith('Refresh Universe'));
  assert.equal(leseZahl(naiv, 'MCAP_PREFILTER_MIN_USD'), 9000000000,
    'Beleg des Befunds: find() liest den falschen Schritt, ohne dass etwas rot wird');
});
