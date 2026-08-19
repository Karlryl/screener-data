// tests/probe-dedup-fingerprint.test.js — Standalone-Runner (framework-los).
// Run: node tests/probe-dedup-fingerprint.test.js
//
// WOFUER: scripts/probe-dedup-fingerprint.js zaehlt, wie viele Firmen doppelt im Board
// stehen, weil der namensbasierte Emittenten-Dedup sie nicht erkennt. Diese Zahl ist die
// Vorher/Nachher-Messlatte fuer den Dedup-Fix — sie muss also selbst stimmen.
//
// DER WICHTIGSTE TEST IST DIE LEERREIHEN-FALLE. Der Fingerabdruck ist "Umsatz- und
// Bruttogewinn-Reihe sind identisch". Pre-Revenue-Biotechs haben LEERE Reihen; leer ist
// gleich leer, also waeren sie nach dem nackten Kriterium alle dieselbe Firma. Genau das
// ist einmal passiert: rund 50 fremde Firmen in einer einzigen Schein-Gruppe (am Vintage
// 2026-07-14 sind es sogar 183 in einer). Die Auflage "mindestens vier endliche
// Umsatzquartale ungleich null" verhindert das — und dieser Test verhindert, dass die
// Auflage jemals still herausfaellt.
//
// GEGENPROBE (durchgefuehrt, jede Pruefung einzeln): Auflage von 4 auf 0 gesetzt ->
// Leerreihen-Test rot (1 Gruppe statt 0). Bruttogewinn aus dem Fingerabdruck entfernt ->
// Nicht-Paar-Test rot. TOP_N auf 25 gehoben -> Rand-Test rot. Marktwert-Naehe als Filter
// eingebaut -> Diagnose-Test rot. JSON-Fehler abgefangen statt geworfen -> Lautstaerke-
// Test rot. Ohne diese Gegenproben waere nicht pruefbar, ob die Tests ueberhaupt beissen.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../scripts/probe-dedup-fingerprint.js');

let ok = 0, fail = 0;
function check(name, fn) {
  try { fn(); ok++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + ((e && e.message) || e)); }
}

// ── Fixture-Helfer ───────────────────────────────────────────────────────────
// Minimale Board-Zeile. rev/gp sind die Reihen, an denen der Fingerabdruck haengt.
function zeile(ticker, rank, rev, gp, mcap, board, track) {
  return {
    ticker, rank, score: 90 - rank, track: track || 'profitable', board: board || 'testboard',
    pit: { revenueQ: rev, grossProfitQ: gp, marketCap: (mcap === undefined ? 1e9 : mcap) },
  };
}
const R5 = [500, 400, 300, 200, 100];
const G5 = [250, 200, 150, 100, 50];
const ANDERS_R = [999, 400, 300, 200, 100];

// Ein Vintage auf der Platte — damit auch das Einlesen geprueft wird und nicht nur die
// reine Rechenfunktion. Ein Waechter, der nur die Innerei sieht, uebersieht die Verdrahtung.
function schreibeVintage(boards, extraDateien) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-dedup-'));
  for (const name of Object.keys(boards)) {
    const zeilen = boards[name];
    const cohort = { profitable: [], unprofitable: [] };
    for (const z of zeilen) cohort[z.track].push({ ticker: z.ticker, rank: z.rank, score: z.score, pit: z.pit });
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ date: '2026-08-19', board: name, cohort }));
  }
  for (const name of Object.keys(extraDateien || {})) {
    fs.writeFileSync(path.join(dir, name), extraDateien[name]);
  }
  return dir;
}

console.log('probe-dedup-fingerprint: Fingerabdruck-Messung');

// ── 1. DIE LEERREIHEN-FALLE — die Pflicht-Auflage ────────────────────────────

check('LEERREIHEN-FALLE: mehrere Firmen mit leeren Reihen sind NICHT eine Firma', () => {
  // Vier verschiedene Pre-Revenue-Firmen, alle mit leerer Umsatz- und Bruttogewinn-Reihe.
  // Ihr Fingerabdruck ist byte-identisch — nur die Auflage trennt sie.
  const leer = [
    zeile('BIOA', 1, [], []),
    zeile('BIOB', 2, [], []),
    zeile('BIOC', 3, [], []),
    zeile('BIOD', 4, [], []),
  ];
  assert.strictEqual(P.fingerabdruck(leer[0].pit), P.fingerabdruck(leer[1].pit),
    'Vorbedingung: ohne Auflage waeren diese Zeilen ununterscheidbar');
  const res = P.messe(leer);
  assert.strictEqual(res.gruppen.length, 0, 'leere Reihen duerfen NIE eine Gruppe ergeben');
  assert.strictEqual(res.zeilenBelastbar, 0, 'keine dieser Zeilen darf ueberhaupt mitzaehlen');
});

check('LEERREIHEN-FALLE, zweite Bauform: null-Reihen und Nullwerte zaehlen ebenfalls nicht', () => {
  // Die Reihen sind in der Praxis nicht immer leere Arrays: mal fehlen sie ganz, mal
  // stehen Nullen oder null-Eintraege drin. Alle drei Formen muessen unter die Auflage fallen.
  const res = P.messe([
    zeile('NULLA', 1, null, null),
    zeile('NULLB', 2, null, null),
  ]);
  assert.strictEqual(res.gruppen.length, 0, 'null-Reihen duerfen keine Gruppe ergeben');
  const nullen = P.messe([
    zeile('ZEROA', 1, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]),
    zeile('ZEROB', 2, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]),
  ]);
  assert.strictEqual(nullen.gruppen.length, 0, 'reine Nullreihen duerfen keine Gruppe ergeben');
  const nichtEndlich = P.messe([
    zeile('NANA', 1, [NaN, null, null, null, null], []),
    zeile('NANB', 2, [NaN, null, null, null, null], []),
  ]);
  assert.strictEqual(nichtEndlich.gruppen.length, 0, 'nicht-endliche Werte zaehlen nicht als Quartal');
});

check('die Auflage sitzt genau bei vier: drei Quartale reichen nicht, vier reichen', () => {
  // Ohne diese Pruefung koennte die Auflage auf 1 rutschen und der Leerreihen-Test bliebe
  // trotzdem gruen — er prueft nur den Fall NULL Quartale.
  const drei = P.messe([
    zeile('DREIA', 1, [300, 200, 100, 0, 0], [150, 100, 50, 0, 0]),
    zeile('DREIB', 2, [300, 200, 100, 0, 0], [150, 100, 50, 0, 0]),
  ]);
  assert.strictEqual(drei.gruppen.length, 0, 'drei Umsatzquartale duerfen NICHT reichen');
  const vier = P.messe([
    zeile('VIERA', 1, [400, 300, 200, 100, 0], [200, 150, 100, 50, 0]),
    zeile('VIERB', 2, [400, 300, 200, 100, 0], [200, 150, 100, 50, 0]),
  ]);
  assert.strictEqual(vier.gruppen.length, 1, 'vier Umsatzquartale MUESSEN reichen');
  assert.strictEqual(P.MIN_UMSATZQUARTALE, 4, 'die Auflage steht bei vier und wird nicht stillschweigend gesenkt');
});

// ── 2. Ein echtes Paar wird gefunden ─────────────────────────────────────────

check('ECHTES PAAR: zwei Listings derselben Firma bilden eine Gruppe', () => {
  const res = P.messe([
    zeile('LLY.DE', 4, R5, G5, 8.0e11),
    zeile('LLY', 5, R5, G5, 8.03e11),
    zeile('FREMD', 6, ANDERS_R, G5, 1e10),
  ]);
  assert.strictEqual(res.gruppen.length, 1, 'genau eine Gruppe');
  const g = res.gruppen[0];
  assert.deepStrictEqual(g.beine.map((b) => b.ticker), ['LLY.DE', 'LLY'], 'beide Beine, nach Platz sortiert');
  assert.strictEqual(g.beine[0].rank, 4);
  assert.strictEqual(g.beine[1].rank, 5);
  assert.strictEqual(g.umsatzquartale, 5);
});

check('NICHT-PAAR: gleicher Umsatz, anderer Bruttogewinn ist KEINE Gruppe', () => {
  // Der Bruttogewinn gehoert mit in den Fingerabdruck. Faellt er raus, verschmelzen zwei
  // Firmen mit zufaellig gleicher Umsatzreihe — bei runden Zahlen kein Kunststueck.
  const res = P.messe([
    zeile('AAA', 1, R5, G5),
    zeile('BBB', 2, R5, [251, 200, 150, 100, 50]),
  ]);
  assert.strictEqual(res.gruppen.length, 0, 'abweichender Bruttogewinn trennt');
  const anders = P.messe([
    zeile('CCC', 1, R5, G5),
    zeile('DDD', 2, ANDERS_R, G5),
  ]);
  assert.strictEqual(anders.gruppen.length, 0, 'abweichender Umsatz trennt');
});

// ── 3. Top-20-Zaehlung ───────────────────────────────────────────────────────

check('Top-20-Paar wird gezaehlt — und der Rand haelt', () => {
  const drin = P.messe([zeile('X.HK', 19, R5, G5), zeile('X.SZ', 20, R5, G5)]);
  assert.strictEqual(drin.gruppen[0].topPaare.length, 1, 'Plaetze 19+20 sind ein Top-20-Paar');
  assert.strictEqual(drin.gruppen[0].topPaare[0].beine.length, 2);
  const raus = P.messe([zeile('Y.HK', 20, R5, G5), zeile('Y.SZ', 21, R5, G5)]);
  assert.strictEqual(raus.gruppen.length, 1, 'die Gruppe bleibt eine Gruppe');
  assert.strictEqual(raus.gruppen[0].topPaare.length, 0, 'Platz 21 gehoert nicht mehr zu den Top 20');
  assert.strictEqual(P.TOP_N, 20, 'die Grenze steht bei 20');
});

check('Top-20 zaehlt je Board-LISTE, nicht ueber Boards hinweg', () => {
  // Die Raenge fangen je Board und Track wieder bei 1 an. Wuerde man sie zusammenwerfen,
  // waere jedes Paar aus zwei verschiedenen Boards ploetzlich ein "Top-20-Paar".
  const res = P.messe([
    zeile('A.MI', 3, R5, G5, 1e9, 'utilities', 'profitable'),
    zeile('A.MC', 4, R5, G5, 1e9, 'industrials', 'profitable'),
  ]);
  assert.strictEqual(res.gruppen.length, 1, 'die Gruppe wird board-uebergreifend erkannt');
  assert.strictEqual(res.gruppen[0].topPaare.length, 0, 'aber sie ist kein Top-20-Paar EINER Liste');
});

// ── 4. Marktwert ist Ausweis, NIE Filter ─────────────────────────────────────

check('MARKTWERT IST KEIN FILTER: ein Paar mit weit auseinanderliegenden Marktwerten zaehlt', () => {
  // Genau der Fall 1377.HK + 301377.SZ: A-/H-Aktien-Doppelnotierung, am 19.08. rund 29 %
  // Marktwert-Abstand, steht aber auf den Plaetzen 9+10 von tech-hardware. Ein
  // Marktwert-Gate wuerde ausgerechnet dieses Paar verfehlen.
  const res = P.messe([
    zeile('1377.HK', 9, R5, G5, 1.0e10),
    zeile('301377.SZ', 10, R5, G5, 0.71e10),
  ]);
  assert.strictEqual(res.gruppen.length, 1, 'weit auseinanderliegende Marktwerte duerfen die Gruppe NICHT verhindern');
  assert.strictEqual(res.gruppen[0].topPaare.length, 1, 'und sie bleibt ein Top-20-Paar');
  assert.ok(res.gruppen[0].mcapNaehe > P.MCAP_AUSWEIS_SCHWELLE,
    'Vorbedingung: der Abstand liegt ueber der Ausweis-Schwelle, war ' + res.gruppen[0].mcapNaehe);
  assert.strictEqual(res.gruppen[0].mcapAusweis, 'weit', 'ausgewiesen wird er trotzdem');
});

check('Marktwert-Naehe rechnet richtig und faellt sauber aus, wenn sie fehlt', () => {
  assert.ok(Math.abs(P.mcapNaehe([{ pit: { marketCap: 100 } }, { pit: { marketCap: 75 } }]) - 0.25) < 1e-12);
  assert.strictEqual(P.mcapNaehe([{ pit: { marketCap: 100 } }, { pit: {} }]), null,
    'ein einzelner Wert ergibt keinen Abstand');
  assert.strictEqual(P.mcapNaehe([{ pit: { marketCap: 0 } }, { pit: { marketCap: 100 } }]), null,
    'Marktwert 0 ist kein Wert, sondern eine Luecke');
});

// ── 5. Einlesen: nichts still verschlucken ───────────────────────────────────

check('Vintage von der Platte: Board-Dateien werden gelesen, Nicht-Boards namentlich ausgewiesen', () => {
  const dir = schreibeVintage({
    'tech-hardware': [zeile('1377.HK', 9, R5, G5, 1e10, 'tech-hardware'), zeile('301377.SZ', 10, R5, G5, 0.71e10, 'tech-hardware')],
    'utilities': [zeile('EINZEL', 1, ANDERS_R, G5, 1e9, 'utilities')],
  }, {
    'calibration.json': JSON.stringify({ schema: 'calibration/v4' }),
    'regime.json': JSON.stringify({ label: 'x' }),
    '_ALTER-MASSSTAB.md': '# kein JSON',
  });
  const b = P.messeVintage('2026-08-19', dir);
  assert.strictEqual(b.boards, 2, 'zwei Boards');
  assert.deepStrictEqual(b.uebersprungen, ['calibration.json', 'regime.json'],
    'Nicht-Boards muessen namentlich auftauchen, nicht stumm verschwinden');
  assert.strictEqual(b.gruppen, 1);
  assert.strictEqual(b.topPaare, 1);
  assert.strictEqual(b.jeBoard['tech-hardware'].gruppen, 1, 'Aufschluesselung je Board');
  assert.strictEqual(b.jeBoard['utilities'].gruppen, 0);
  assert.ok(P.textbericht([b]).includes('1377.HK'), 'der Textbericht nennt die Ticker');
  fs.rmSync(dir, { recursive: true, force: true });
});

check('kaputtes Board-JSON wird LAUT, nicht still uebersprungen', () => {
  // Ein nicht lesbares Board wuerde die Gruppenzahl still zu niedrig machen — die
  // Messlatte waere dann falsch, ohne dass es jemand merkt.
  const dir = schreibeVintage({ 'tech-hardware': [zeile('A', 1, R5, G5, 1e9, 'tech-hardware')] });
  fs.writeFileSync(path.join(dir, 'kaputt.json'), '{ das ist kein JSON');
  assert.throws(() => P.messeVintage('2026-08-19', dir), /nicht lesbar/,
    'kaputtes JSON muss werfen');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.throws(() => P.ladeVintage(path.join(os.tmpdir(), 'gibt-es-nicht-probe-dedup')), /fehlt/,
    'ein fehlendes Vintage-Verzeichnis muss werfen');
});

console.log(ok + ' ok, ' + fail + ' fail');
console.log(fail === 0 ? 'ALLE GRUEN' : fail + ' FEHLER');
process.exit(fail === 0 ? 0 : 1);
