'use strict';
/**
 * U1 (Orchestrator ENTSCHIED 21, 2026-08-29) — Namens-Platzhalter an der Quelle heilen.
 *
 * BEFUND (Akte befund-doppelgaenger-2026-08-29.md): `pull-yahoo.js` fiel bei fehlendem
 * `longName` DIREKT auf den Ticker zurueck, also `meta.name === meta.ticker` — 110 von 15.046
 * Snapshots, 3.225 von 20.762 Watchlist-Zeilen (Stand 29.08.). Der Emittenten-Dedup gruppiert
 * ueber den Namen (`issuerKeyLoose`, src/scoring/score.js:134), also konnte ein solcher
 * Platzhalter nie mit dem Klarnamen der Zweitnotiz verschmelzen: 27 der 53 doppelt im Board
 * stehenden Emittenten hingen genau daran.
 *
 * DIESER WAECHTER prueft das VERHALTEN des Mappers (mapYahooToCanonical wird AUSGEFUEHRT,
 * nicht der Quelltext nach Schreibmustern durchsucht — gleiche Bauform wie
 * tests/opinc-source.test.js und tests/a10-jahres-periodenenden.test.js).
 *
 * DIE TRAGENDE EIGENSCHAFT ist nicht die Ausbeute, sondern die EINSEITIGKEIT:
 * der Name entsteht ausschliesslich aus Feldern DIESES Wertpapiers (Yahoo-Datensatz +
 * eigene Watchlist-Zeile). Es gibt keinen Pfad, auf dem er aus einem FREMDEN Datensatz
 * stammt. Deshalb kann diese Kette eine Verschmelzung nur VERHINDERN, nie ERZWINGEN — und
 * genau deshalb durfte U1 ohne Gericht gebaut werden (ENTSCHIED 21 Punkt 2). Faellt diese
 * Wache, ist die Begruendung des Entscheids weg, nicht nur ein Detail.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/u1-namensplatzhalter.test.js
 */
const assert = require('node:assert/strict');
const { mapYahooToCanonical } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const ASOF = '2026-08-29T00:00:00.000Z';
const mappe = (price, wl) => mapYahooToCanonical({ price }, wl, ASOF).meta.name;

// ─── 1. Die neue Zwischenstufe ──────────────────────────────────────────────────

test('shortName fuellt die Luecke, wo bisher der Ticker stand', () => {
  assert.equal(
    mappe({ shortName: 'Gen Digital Inc.' }, { ticker: 'GEN' }),
    'Gen Digital Inc.',
    'ohne longName muss shortName greifen — vorher stand hier "GEN"',
  );
});

test('ohne longName UND ohne shortName bleibt der bisherige Rueckfall bestehen', () => {
  assert.equal(mappe({}, { ticker: 'GEN', name: 'Gen Digital Inc.' }), 'Gen Digital Inc.',
    'die Watchlist-Zeile bleibt die dritte Stufe');
  assert.equal(mappe({}, { ticker: 'GEN' }), 'GEN',
    'ganz ohne Namen bleibt der Ticker-Platzhalter — ehrlich, statt geraten');
});

test('longName gewinnt IMMER: ein vorhandener Klarname wird nie ueberschrieben', () => {
  assert.equal(
    mappe({ longName: 'Gen Digital Inc.', shortName: 'GEN DIGITAL' }, { ticker: 'GEN', name: 'Irgendwas' }),
    'Gen Digital Inc.',
    'die Reihenfolge longName > shortName > Watchlist > Ticker darf sich nicht drehen',
  );
});

test('leere/whitespace-Werte fallen durch, statt einen leeren Namen zu setzen', () => {
  // Ein leerer Name macht issuerName() null -> der Stand faellt aus dem Dedup HERAUS. Das waere
  // schlimmer als der Platzhalter, weil es lautlos passiert.
  assert.equal(mappe({ longName: '', shortName: 'Gen Digital Inc.' }, { ticker: 'GEN' }), 'Gen Digital Inc.');
  assert.equal(mappe({ longName: null, shortName: null }, { ticker: 'GEN', name: '' }), 'GEN');
});

// ─── 2. Die tragende Eigenschaft: EINSEITIG SICHER ──────────────────────────────

test('EINSEITIGKEIT: der Name stammt IMMER aus einem Feld dieses Wertpapiers', () => {
  // Das ist die Kernzusage von ENTSCHIED 21 Punkt 2. Ueber alle 16 Belegungen der vier
  // Quellen hinweg muss das Ergebnis eines der vier EIGENEN Felder sein — nie etwas anderes.
  const werte = [undefined, 'Q-longName', ''];
  const kurz = [undefined, 'Q-shortName', ''];
  const wlN = [undefined, 'W-name', ''];
  for (const longName of werte) {
    for (const shortName of kurz) {
      for (const name of wlN) {
        const wl = { ticker: 'TCK', name };
        const ergebnis = mappe({ longName, shortName }, wl);
        const eigeneFelder = [longName, shortName, name, 'TCK'].filter((v) => typeof v === 'string' && v !== '');
        assert.ok(eigeneFelder.includes(ergebnis),
          `"${ergebnis}" muss aus den eigenen Feldern stammen (${JSON.stringify(eigeneFelder)})`);
      }
    }
  }
});

test('EINSEITIGKEIT: ein FREMDER Datensatz aendert den eigenen Namen nicht', () => {
  // Kein Quer-Kanal: derselbe Eingang liefert denselben Namen, egal was vorher/nachher
  // gemappt wurde. Damit kann U1 zwei verschiedene Firmen nicht zusammenziehen.
  const eigener = { longName: undefined, shortName: undefined };
  const vorher = mappe(eigener, { ticker: 'AAA' });
  mappe({ longName: 'Banco Santander, S.A.', shortName: 'SANTANDER' }, { ticker: 'SAN', name: 'Banco Santander' });
  mappe({ longName: 'Sanofi' }, { ticker: '1SAN.MI' });
  const nachher = mappe(eigener, { ticker: 'AAA' });
  assert.equal(vorher, 'AAA');
  assert.equal(nachher, 'AAA', 'ein fremd gemappter Klarname darf hier nie einsickern');
});

test('EINSEITIGKEIT-Gegenprobe (absichtlicher Bruch): eine Fremdquelle wuerde auffliegen', () => {
  // Nachbau dessen, was NICHT gebaut werden darf: ein Namensregister ueber alle Ticker, das
  // bei fehlendem Namen irgendeinen fremden Klarnamen einsetzt. Zeigt, dass die Wache greift.
  const fremdregister = { AAA: 'Sanofi' };
  const kaputt = (price, wl) => price.longName || price.shortName || wl.name || fremdregister[wl.ticker] || wl.ticker;
  const ergebnis = kaputt({}, { ticker: 'AAA' });
  assert.equal(ergebnis, 'Sanofi', 'die verbotene Variante zieht tatsaechlich einen fremden Namen');
  assert.throws(() => {
    assert.ok(['AAA'].includes(ergebnis), 'Name muss aus den eigenen Feldern stammen');
  }, 'die Einseitigkeits-Wache MUSS bei einer Fremdquelle rot werden');
});

// ─── 3. Wirkung auf den Dedup ───────────────────────────────────────────────────

test('Wirkung: geheilter Platzhalter faellt mit der Zweitnotiz auf denselben Emittenten-Schluessel', () => {
  // Gemessen am echten issuerKeyLoose, nicht an einem Nachbau (Fehler F1334).
  const { issuerKeyLoose } = require('../src/scoring/score.js');
  const k = (n) => issuerKeyLoose({ meta: { name: n } });
  const vorher = mappe({}, { ticker: 'GEN' });                       // alter Zustand: Platzhalter
  const nachher = mappe({ shortName: 'Gen Digital Inc.' }, { ticker: 'GEN' });
  const zweitnotiz = 'Gen Digital Inc.';
  assert.notEqual(k(vorher), k(zweitnotiz), 'Vorbedingung: der Platzhalter trennte die beiden Beine');
  assert.equal(k(nachher), k(zweitnotiz), 'nach der Heilung sieht der Dedup EINEN Emittenten');
});

console.log(`\nu1-namensplatzhalter.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
