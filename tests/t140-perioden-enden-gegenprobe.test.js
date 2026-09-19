// Waechter fuer scripts/t140-perioden-enden-gegenprobe.js (T140, 19.09.2026).
//
// Gepinnt wird die SACHE, nicht ein Schreibmuster: der Klassierer muss die vier
// Uebergaenge eines Perioden-Enden-Paars auseinanderhalten und darf die Kipp-Bedingung
// von T140 ("Array -> Array, Datum geaendert, Werte identisch") weder verpassen noch
// mit inhaltslosen 0-Reihen aufblasen. Beides einmal absichtlich gebrochen und rot
// gesehen: kipp-Zweig entfernt -> 2 rot; inhaltslos() auf `false` festgenagelt -> 2 rot.
//
// Framework-los: assert + process.exit. Hermetisch (keine Vintages noetig, das Gate
// laeuft vor dem Pull). Run: node tests/t140-perioden-enden-gegenprobe.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { vergleiche, inhaltslos, ladeVintage, paareOhneVergleich } = require('../scripts/t140-perioden-enden-gegenprobe.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const ENDEN_ALT = ['2026-03-31', '2025-12-31'];
const ENDEN_NEU = ['2026-06-30', '2026-03-31'];

function pit(over) {
  return Object.assign({
    revenueQ: [10, 20], revenueQEnds: ENDEN_ALT.slice(),
    grossProfitQ: [3, 4], grossProfitQEnds: ENDEN_ALT.slice(),
  }, over);
}
function paar(altOver, neuOver) {
  return vergleiche(new Map([['energy|X', pit(altOver)]]), new Map([['energy|X', pit(neuOver)]]));
}

check('Rollover (Enden UND Werte bewegen sich) ist kein Kipp-Treffer', () => {
  const r = paar({}, { revenueQEnds: ENDEN_NEU.slice(), revenueQ: [30, 10] }).revenueQEnds;
  assert.strictEqual(r.arrArr, 1, 'arr->arr nicht erkannt');
  assert.strictEqual(r.kipp, 0, 'Rollover faelschlich als Kipp gezaehlt');
  assert.strictEqual(r.werteGeaendert, 1);
});

check('DER Befund: Enden geaendert, Werte byte-identisch und nicht leer -> kipp', () => {
  const r = paar({}, { revenueQEnds: ENDEN_NEU.slice() }).revenueQEnds;
  assert.strictEqual(r.kipp, 1, 'die Kipp-Bedingung von T140 wird nicht gezaehlt');
  assert.strictEqual(r.kippZero, 0);
  assert.deepStrictEqual(r.kippZeilen[0].von, ENDEN_ALT);
  assert.deepStrictEqual(r.kippZeilen[0].nach, ENDEN_NEU);
});

check('inhaltslose 0-Reihe wandert mit dem Fenster -> kippZero, NICHT kipp', () => {
  const r = paar({ revenueQ: [0, 0] }, { revenueQ: [0, 0], revenueQEnds: ENDEN_NEU.slice() }).revenueQEnds;
  assert.strictEqual(r.kipp, 0, 'eine 0-Reihe wird als Neu-Etikettierung ausgegeben');
  assert.strictEqual(r.kippZero, 1);
});

check('null -> Array (Feldeinfuehrung) ist eigene Klasse, kein Kipp', () => {
  const r = paar({ revenueQEnds: null }, {}).revenueQEnds;
  assert.strictEqual(r.nullToArr, 1);
  assert.strictEqual(r.arrArr, 0);
  assert.strictEqual(r.kipp, 0);
});

check('Array -> null (Gewinnerwechsel/Verlust) ist eigene Klasse', () => {
  const r = paar({}, { revenueQEnds: null }).revenueQEnds;
  assert.strictEqual(r.arrToNull, 1);
  assert.strictEqual(r.kipp, 0);
});

check('beide Reihen werden getrennt klassiert (eigenes Ends-Array je Reihe)', () => {
  const rec = paar({}, { revenueQEnds: ENDEN_NEU.slice(), revenueQ: [30, 10], grossProfitQEnds: ENDEN_NEU.slice() });
  assert.strictEqual(rec.revenueQEnds.kipp, 0, 'Umsatz-Rollover leckt in den Umsatz-Kipp');
  assert.strictEqual(rec.grossProfitQEnds.kipp, 1, 'Bruttogewinn-Kipp wird vom Umsatz ueberdeckt');
});

check('nur in BEIDEN Staenden vorhandene Zeilen zaehlen', () => {
  const rec = vergleiche(new Map([['energy|X', pit()], ['energy|WEG', pit()]]), new Map([['energy|X', pit()]]));
  assert.strictEqual(rec.gemeinsam, 1, 'eine entrangte Zeile wird mitgezaehlt');
});

check('inhaltslos(): leer, 0-Reihe und null-Reihe ja — ein einziger Wert nein', () => {
  assert.strictEqual(inhaltslos([]), true);
  assert.strictEqual(inhaltslos(null), true);
  assert.strictEqual(inhaltslos([0, 0, 0]), true);
  assert.strictEqual(inhaltslos([null, 0]), true);
  assert.strictEqual(inhaltslos([0, 0, 1]), false, 'eine Reihe mit Inhalt wird als leer verworfen');
});

// ── Regression: das survival-Board darf NICHT stillschweigend rausfallen ────────────
// Die erste Fassung fuehrte eine Namensliste ['calibration','regime','survival'] mit der
// Begruendung "tragen kein cohort". Fuer survival.json ist das falsch — die Liste nahm
// 24 Boards aus der Messung, ohne dass irgendwo eine Zahl kleiner aussah. Der Waechter
// pinnt die SACHE: eine Datei mit `cohort` wird gemessen, egal wie sie heisst.
check('jede Board-Datei mit `cohort` wird geladen — auch survival.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't140-'));
  try {
    fs.writeFileSync(path.join(dir, 'survival.json'), JSON.stringify(
      { board: 'survival', cohort: { profitable: [{ ticker: 'SURV', pit: pit() }] } }));
    fs.writeFileSync(path.join(dir, 'calibration.json'), JSON.stringify({ was: 'kein cohort' }));
    const m = ladeVintage(dir);
    assert.deepStrictEqual([...m.keys()], ['survival|SURV'],
      'survival.json faellt aus der Messung — die Namensliste ist zurueck');
    assert.deepStrictEqual([...ladeVintage(dir, false, true).keys()], [],
      '--ohne-survival wirkt nicht');
    assert.deepStrictEqual([...ladeVintage(dir, true).keys()], ['survival|profitable|SURV'],
      'der Track fehlt im gebundenen Schluessel');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// "0 Treffer auf 0 verglichenen Zeilen" sieht aus wie ein sauberes Negativergebnis und
// ist keins (Skip-ist-nicht-Pass, T147). Weil das Ergebnis dieses Skripts eine NEGATIVE
// Aussage ist, muss ein Paar ohne gemeinsame Zeilen laut werden statt still gruen.
check('ein Paar ohne eine einzige gemeinsame Zeile wird gemeldet, nicht als 0 gefeiert', () => {
  const leer = vergleiche(new Map(), new Map());
  assert.strictEqual(leer.gemeinsam, 0);
  assert.strictEqual(leer.revenueQEnds.kipp, 0, 'ohne Zeilen kann es keine Treffer geben');
  assert.deepStrictEqual(
    paareOhneVergleich([{ paar: 'a->b', gemeinsam: 0 }, { paar: 'b->c', gemeinsam: 7 }]),
    ['a->b'], 'das leere Paar wird nicht gemeldet — die Messung koennte nichts verglichen haben');
  assert.deepStrictEqual(paareOhneVergleich([{ paar: 'b->c', gemeinsam: 7 }]), [],
    'ein gefuelltes Paar wird faelschlich gemeldet');
});

console.log(fail === 0 ? '\nT140-Gegenprobe: ALL PASS' : `\nT140-Gegenprobe: ${fail} FAIL`);
process.exit(fail ? 1 : 0);
