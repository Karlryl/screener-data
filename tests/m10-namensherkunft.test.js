'use strict';
/**
 * M10 / G3-a — die Herkunft des Namens wird mitgeschrieben, BEVOR das Merkmal verschwindet.
 *
 * WARUM ES DIESES FELD GIBT (Akte akte-m10-identitaet-2026-08-30.md, G3): Die Frage, ob ein
 * Bein, dessen Name nur aus der Watchlist stammt, eine Emittentengruppe gewinnen darf (G2),
 * ist heute eine Entscheidung unter UNBEKANNTEM Nutzen bei bekanntem Preis — die Obergrenze
 * liegt bei 6.862 Zeilen, die echte Klassengroesse kennt niemand. Das einzige heutige
 * Ersatz-Merkmal (`name === ticker`) verschwindet mit der 30-Tage-Rotation: spaetestens am
 * 25.09.2026 traegt jede watchlist-benannte Zeile still einen Feed-Namen. G3-c („vertagen
 * ohne Messung") ist deshalb keine Vertagung, sondern Beweisvernichtung.
 *
 * WAS DIESER WAECHTER PINNT — zwei Dinge, und das zweite ist das wichtigere:
 *  (1) `meta.nameSource` nennt die Sprosse, aus der `meta.name` wirklich stammt.
 *  (2) `meta.name` ist durch die Umstellung UNVERAENDERT geblieben. Der Name entstand vorher
 *      aus einer `||`-Kette; jetzt aus derselben Kette als Liste. Waere dabei die Reihenfolge
 *      oder das Leerstring-Verhalten gekippt, aenderte sich die Emittenten-Gruppierung
 *      (`issuerKeyLoose` gruppiert ueber den Namen) — also genau die Sache, die M10 gerade
 *      NICHT anfassen darf, solange das Gericht nicht entschieden hat.
 *
 * Der Mapper wird AUSGEFUEHRT, nicht der Quelltext nach Mustern durchsucht (gleiche Bauform
 * wie tests/u1-namensplatzhalter.test.js).
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/m10-namensherkunft.test.js
 */
const assert = require('node:assert/strict');
const { mapYahooToCanonical } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const ASOF = '2026-08-30T00:00:00.000Z';
const meta = (price, wl) => mapYahooToCanonical({ price }, wl, ASOF).meta;

// Die alte Kette woertlich — sie ist der Massstab fuer Punkt (2) oben.
const alteKette = (price, wl) =>
  (price && price.longName) || (price && price.shortName) || wl.name || wl.ticker;

const FAELLE = [
  ['longName gewinnt',            { longName: 'Alpha AG', shortName: 'Alpha', }, { ticker: 'AL.DE', name: 'Alpha aus Watchlist' }, 'longName',  'Alpha AG'],
  ['shortName als Zwischenstufe', { shortName: 'Beta Inc' },                     { ticker: 'BE',    name: 'Beta aus Watchlist' },  'shortName', 'Beta Inc'],
  ['Watchlist-Name traegt',       {},                                            { ticker: 'GA.MI', name: 'Gamma SpA' },           'watchlist', 'Gamma SpA'],
  ['Ticker als letzter Rueckfall',{},                                            { ticker: 'DE.L' },                               'ticker',    'DE.L'],
];

// ─── 1. Jede Sprosse wird beim Namen genannt ────────────────────────────────────
for (const [titel, price, wl, quelle, name] of FAELLE) {
  test('Herkunft: ' + titel, () => {
    const m = meta(price, wl);
    assert.equal(m.nameSource, quelle, 'nameSource muss die benutzte Sprosse nennen');
    assert.equal(m.name, name, 'der Name selbst bleibt der der Kette');
  });
}

// ─── 2. Leere Zeichenketten zaehlen nicht als Name (Verhalten der alten ||-Kette) ─
test('leerer longName faellt durch, Herkunft folgt mit', () => {
  const m = meta({ longName: '', shortName: 'Delta Corp' }, { ticker: 'DL', name: 'Delta WL' });
  assert.equal(m.name, 'Delta Corp');
  assert.equal(m.nameSource, 'shortName', 'ein leerer Feed-Name darf nicht als Feed-Herkunft gelten');
});

test('leerer Watchlist-Name faellt auf den Ticker durch', () => {
  const m = meta({}, { ticker: 'EP.PA', name: '' });
  assert.equal(m.name, 'EP.PA');
  assert.equal(m.nameSource, 'ticker');
});

// ─── 3. GEGENPROBE: der Name selbst ist unveraendert ────────────────────────────
// Ohne diesen Block koennte die Umstellung die Reihenfolge gekippt haben und der Test
// oben waere trotzdem gruen — er prueft dann nur noch sich selbst.
test('Gegenprobe: der Name ist bitgleich zur alten ||-Kette, ueber alle Faelle', () => {
  const matrix = [
    ...FAELLE.map(([, p, w]) => [p, w]),
    [{ longName: '', shortName: '' }, { ticker: 'X1', name: 'Nur Watchlist' }],
    [{ longName: null, shortName: undefined }, { ticker: 'X2', name: null }],
    [{ longName: 'Zeta' }, { ticker: 'X3' }],
  ];
  for (const [p, w] of matrix) {
    assert.equal(meta(p, w).name, alteKette(p, w),
      'Name weicht von der alten Kette ab fuer ' + JSON.stringify([p, w]));
  }
});

// ─── 4. Bruchprobe: das Feld darf nicht raten ───────────────────────────────────
test('Bruchprobe: nameSource ist nie eine Sprosse, die gar nichts geliefert hat', () => {
  // Ein Feld, das immer "longName" sagt, waere fuer die Messung schlimmer als keines —
  // es saehe aus wie ein Befund. Diese Probe faellt genau dann, wenn die Herkunft nicht
  // aus derselben Wahl stammt wie der Name.
  for (const [, price, wl] of FAELLE) {
    const m = meta(price, wl);
    const geliefert = { longName: price.longName, shortName: price.shortName, watchlist: wl.name, ticker: wl.ticker };
    assert.ok(geliefert[m.nameSource], 'nameSource=' + m.nameSource + ' behauptet eine leere Quelle');
    assert.equal(geliefert[m.nameSource], m.name, 'die genannte Quelle muss den Namen wirklich tragen');
  }
});

// --- 5. Die Total-Leerzeile: keine Sprosse hat geliefert ------------------------
// Review-Fund 30.08.: der Rueckfall setzte die Herkunft hart auf 'ticker', auch wenn der
// Ticker selbst leer war. Das ist die teuerste Luege, die dieses Feld erzaehlen kann - die
// Messung haette eine kaputte Zeile als legitime Ticker-Herkunft gezaehlt und damit genau
// die Klasse unterschaetzt, die sie sichtbar machen soll.
for (const [titel, wl] of [
  ['Ticker fehlt', { ticker: undefined }],
  ['Ticker leer', { ticker: '' }],
  ['alles null', { ticker: null, name: null }],
]) {
  test('Total-Leerzeile (' + titel + '): keine Herkunft statt falscher Herkunft', () => {
    const m = meta({}, wl);
    assert.equal(m.nameSource, null, 'ohne gelieferte Sprosse darf keine benannt werden');
    assert.equal(m.name, wl.ticker, 'der Name bleibt exakt das, was die alte Kette lieferte');
  });
}

console.log(`\nm10-namensherkunft.test.js: ${pass} ok, ${fail} fail`);
if (fail) process.exit(1);
