// tests/voll-pull-ticker.test.js — Standalone-Runner (framework-los).
// Run: node tests/voll-pull-ticker.test.js
//
// WOFUER: Waechter zur workflow_dispatch-Eingabe `voll_pull_ticker` (Orchestrator-Beschluss
// 02.09.2026, Mechanismus A). Sie zieht BENANNTE Ticker einmalig voll — der einzige Weg,
// einen jungen aber beschaedigten Snapshot zu heilen, bevor die 30-Tage-Frist ihn ohnehin
// erneuert. Belegter Anlass: FTI verlor am 02.09. seine annualOpInc-Reihe; bis zur Heilung
// nimmt das Wert-Gate ueber den Integritaets-Vorrang JEDEN Tag das ganze Tagesverzeichnis
// vom Commit aus, der Vorgaenger rueckt nie vor, und der Verfall wird morgen erneut gegen
// denselben eingefrorenen Stand gemessen — eine sich selbst verstaerkende Dauersperre.
//
// DIE REGEL WIRD AUSGEFUEHRT, NICHT NACHGEBAUT: parseVollPullTicker ist aus pull-yahoo.js
// exportiert und wird hier direkt aufgerufen (Fehlerklasse F1334 — ein Nachbau prueft die
// Kopie im Test und laesst die echte Regel durch).
//
// DREI EIGENSCHAFTEN, DIE HIER FESTGENAGELT SIND, jede mit Gegenprobe:
//   1. Unbekannter Ticker = BENANNTER Abbruch, kein stiller Skip. Ein Tippfehler ist der
//      wahrscheinlichste Bedienfehler; still uebergangen saehe der Lauf wie ein Erfolg aus,
//      waehrend die angeforderte Heilung nie stattgefunden haette.
//   2. Ueberschreitung der Obergrenze = Abbruch. Die Eingabe heilt Einzelfaelle; eine
//      Massen-Anforderung liefe am Budget und am Coverage-Gate vorbei.
//   3. SELBST-ABLAUF: die Menge haengt ausschliesslich am uebergebenen Rohwert. Es gibt
//      keinen Zustand, der einen Lauf ueberdauert — genau das trennt die Eingabe von der
//      Bug-13-Klasse (Melder feuert, Wache unterdrueckt das Feld, Melder feuert wieder),
//      die dieses Modul an drei Stellen dokumentiert.
//
// ABSICHTLICH GEBROCHEN (jede Probe war einmal rot, Ergebnis im Commit-Text):
//   Filter `!bekannteTicker.has(t)` entfernt      -> "unbekannter Ticker muss abbrechen"
//   Cap-Pruefung entfernt                          -> "51 Ticker muessen abbrechen"
//   `liste` gegen ein Modul-Set getauscht (sticky) -> "kein Zustand ueberdauert den Lauf"
'use strict';
const assert = require('assert');
const Y = require('../pull-yahoo.js');

const { parseVollPullTicker, VOLL_PULL_CAP } = Y;
const BEKANNT = new Set(['FTI', 'UMAC', 'ASTS', 'RIO.L', '000166.SZ']);

let rot = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { rot++; console.error('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Verdrahtung ─────────────────────────────────────────────────────────────
check('die Regel ist exportiert und die Obergrenze ist eine Zahl', () => {
  assert.strictEqual(typeof parseVollPullTicker, 'function', 'parseVollPullTicker nicht exportiert');
  assert.ok(Number.isInteger(VOLL_PULL_CAP) && VOLL_PULL_CAP > 0, 'VOLL_PULL_CAP fehlt oder ist keine Zahl');
});

// ── ABWESENHEIT: ohne Eingabe wird niemand erzwungen ────────────────────────
check('ABWESENHEIT: leere, fehlende und nur-Trenner-Eingaben erzwingen NICHTS', () => {
  for (const roh of ['', '   ', ',', ',,, ,', undefined, null]) {
    const m = parseVollPullTicker(roh, BEKANNT);
    assert.strictEqual(m.size, 0, 'Eingabe ' + JSON.stringify(roh) + ' erzeugt eine nicht-leere Menge');
  }
});

check('ABWESENHEIT: der Cron-Fall (Umgebungsvariable nicht gesetzt) ist die leere Menge', () => {
  // Im Cron-Lauf existiert `inputs` nicht; die Workflow-Zeile setzt VOLL_PULL_TICKER dann
  // auf den leeren String. Genau dieser Wert darf niemanden erzwingen.
  assert.strictEqual(parseVollPullTicker(process.env.VOLL_PULL_TICKER_GIBTESNICHT, BEKANNT).size, 0);
});

// ── ANWESENHEIT: der benannte Ticker kommt an ───────────────────────────────
check('ANWESENHEIT: der benannte Ticker steht in der Menge, und nur er', () => {
  const m = parseVollPullTicker('FTI', BEKANNT);
  assert.strictEqual(m.size, 1);
  assert.ok(m.has('FTI'), 'FTI fehlt in der Menge');
  assert.ok(!m.has('UMAC'), 'ein nicht angeforderter Ticker ist in der Menge gelandet');
});

check('ANWESENHEIT: Leerraum und mehrere Namen werden sauber getrennt', () => {
  const m = parseVollPullTicker('  FTI , UMAC,ASTS  ', BEKANNT);
  assert.deepStrictEqual([...m].sort(), ['ASTS', 'FTI', 'UMAC']);
});

check('ANWESENHEIT: Ticker mit Punkt und Ziffern (Boersensuffixe) ueberleben das Parsen', () => {
  const m = parseVollPullTicker('RIO.L,000166.SZ', BEKANNT);
  assert.deepStrictEqual([...m].sort(), ['000166.SZ', 'RIO.L']);
});

// ── BRUCHPROBE 1: unbekannter Ticker = benannter Abbruch ────────────────────
check('BRUCH: ein unbekannter Ticker bricht ab UND wird im Text genannt', () => {
  let geworfen = null;
  try { parseVollPullTicker('FTII', BEKANNT); } catch (e) { geworfen = e; }
  assert.ok(geworfen, 'unbekannter Ticker muss abbrechen — ein stiller Skip ist der Fehler, den diese Probe verhindert');
  assert.ok(/FTII/.test(geworfen.message), 'der abgelehnte Name fehlt im Abbruchtext: ' + geworfen.message);
  assert.ok(/voll_pull_ticker/.test(geworfen.message), 'die Eingabe wird im Abbruchtext nicht benannt');
});

check('BRUCH: ein GUELTIGER Name neben einem falschen rettet den Lauf NICHT', () => {
  // Sonst waere der Teil-Erfolg der stille Pfad: FTI liefe, der Tippfehler verschwaende.
  let geworfen = null;
  try { parseVollPullTicker('FTI,UMACC', BEKANNT); } catch (e) { geworfen = e; }
  assert.ok(geworfen, 'eine Liste mit einem falschen Namen muss ganz abbrechen');
  assert.ok(/UMACC/.test(geworfen.message), 'der falsche Name fehlt im Text');
  assert.ok(!/\bFTI\b,/.test(geworfen.message.split('unbekannte Ticker')[1] || ''),
    'der gueltige Name darf nicht als unbekannt gemeldet werden');
});

check('BRUCH-GEGENPROBE: derselbe Aufruf mit vollstaendiger Liste laeuft durch', () => {
  const m = parseVollPullTicker('FTI,UMAC', BEKANNT);
  assert.strictEqual(m.size, 2, 'die Gegenprobe muss gruen sein, sonst prueft Probe 1 nichts');
});

// ── BRUCHPROBE 2: Obergrenze ────────────────────────────────────────────────
check('BRUCH: mehr als VOLL_PULL_CAP Ticker brechen ab, mit Anzahl und Grenze im Text', () => {
  const viele = Array.from({ length: VOLL_PULL_CAP + 1 }, (_, i) => 'T' + i);
  let geworfen = null;
  try { parseVollPullTicker(viele.join(','), new Set(viele)); } catch (e) { geworfen = e; }
  assert.ok(geworfen, (VOLL_PULL_CAP + 1) + ' Ticker muessen abbrechen');
  assert.ok(geworfen.message.includes(String(VOLL_PULL_CAP + 1)), 'die uebergebene Anzahl fehlt im Text');
  assert.ok(geworfen.message.includes(String(VOLL_PULL_CAP)), 'die Obergrenze fehlt im Text');
});

check('BRUCH-GEGENPROBE: genau VOLL_PULL_CAP Ticker sind erlaubt (die Grenze schliesst ein)', () => {
  const genau = Array.from({ length: VOLL_PULL_CAP }, (_, i) => 'T' + i);
  const m = parseVollPullTicker(genau.join(','), new Set(genau));
  assert.strictEqual(m.size, VOLL_PULL_CAP);
});

check('die Obergrenze greift VOR der Namenspruefung — sonst listet der Abbruch 5000 Namen', () => {
  const viele = Array.from({ length: VOLL_PULL_CAP + 1 }, (_, i) => 'UNBEKANNT' + i);
  let geworfen = null;
  try { parseVollPullTicker(viele.join(','), BEKANNT); } catch (e) { geworfen = e; }
  assert.ok(geworfen);
  assert.ok(/Obergrenze/.test(geworfen.message),
    'bei Cap-Bruch muss der Cap-Text kommen, nicht eine Namensliste: ' + geworfen.message.slice(0, 120));
});

// ── BRUCHPROBE 3: SELBST-ABLAUF ─────────────────────────────────────────────
check('SELBST-ABLAUF: kein Zustand ueberdauert den Aufruf', () => {
  // Der eigentliche Punkt der Eingabe: sie gilt fuer EINEN Lauf. Traegt die Regel
  // irgendeinen Modul-Zustand, wuerde ein einmal angeforderter Ticker weiter erzwungen —
  // die Bug-13-Dauerschleife, gegen die dieses Modul dreimal dokumentiert ist.
  assert.strictEqual(parseVollPullTicker('FTI', BEKANNT).size, 1, 'Vorbedingung');
  assert.strictEqual(parseVollPullTicker('', BEKANNT).size, 0,
    'nach einer Anforderung erzwingt der naechste Lauf ohne Eingabe wieder NICHTS');
  assert.strictEqual(parseVollPullTicker('UMAC', BEKANNT).size, 1, 'Vorbedingung 2');
  const m = parseVollPullTicker('FTI', BEKANNT);
  assert.deepStrictEqual([...m], ['FTI'], 'ein frueherer Aufruf faerbt in die Menge ab');
});

check('SELBST-ABLAUF: die zurueckgegebene Menge ist nicht geteilt (Mutation faerbt nicht ab)', () => {
  const a = parseVollPullTicker('FTI', BEKANNT);
  a.add('ASTS');
  const b = parseVollPullTicker('FTI', BEKANNT);
  assert.strictEqual(b.size, 1, 'zwei Aufrufe teilen sich dieselbe Menge');
});

// ── Die Verdrahtung, die den Waechter ueberhaupt erst wirksam macht ─────────
check('VERDRAHTUNG: die Pruefung laeuft VOR dem Sharding (volle watchlist)', () => {
  // shardStocks schneidet die Liste per Ticker-Hash auf ~1/17. Gegen die SCHEIBE geprueft
  // waere derselbe gueltige Ticker in 16 von 17 Shards "unbekannt" und braechte 16 Laeufe
  // grundlos ab. Am Objekt gemessen statt behauptet: der Hash verteilt, also liegt FTI in
  // genau einer Scheibe von 17.
  const alle = [...BEKANNT].map((t) => ({ ticker: t }));
  const scheiben = [];
  for (let i = 0; i < 17; i++) scheiben.push(Y.shardStocks(alle, { index: i, count: 17 }));
  const treffer = scheiben.filter((s) => s.some((x) => x.ticker === 'FTI')).length;
  assert.strictEqual(treffer, 1, 'FTI muss in genau einer Scheibe liegen');
  const summe = scheiben.reduce((n, s) => n + s.length, 0);
  assert.strictEqual(summe, alle.length, 'die Scheiben muessen disjunkt und vollstaendig sein');
  // Und die Folge: gegen eine Scheibe geprueft waere FTI in 16 Faellen unbekannt.
  const scheibeOhneFTI = scheiben.find((s) => !s.some((x) => x.ticker === 'FTI')) || [];
  assert.throws(
    () => parseVollPullTicker('FTI', new Set(scheibeOhneFTI.map((x) => x.ticker))),
    /unbekannte Ticker FTI/,
    'genau dieser Abbruch ist der Grund, warum main() vor dem Sharding pruefen MUSS',
  );
});

console.log(rot === 0 ? '\nOK: voll-pull-ticker' : '\nROT: voll-pull-ticker (' + rot + ')');
process.exit(rot === 0 ? 0 : 1);
