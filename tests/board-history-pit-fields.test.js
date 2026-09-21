// tests/board-history-pit-fields.test.js — Waechter der LT1-PIT-Matching-Felder
// (Rat 10 vom 19.09.2026, Option ii; Vertrag: reports/2026-09-19_lt1_pit_field_contract_DRAFT.md).
//
// Gegenstand sind die vier Felder, die write-board-history.js ab jetzt an JEDE
// Kohorten-Zeile haengt: vol_60d, vol_decile, momentum_12m_residual,
// momentum_12m_residual_decile — und der Vintage-Kopf pitFieldCoverage.
//   (a) Von Hand gerechnetes Vol-Beispiel (geschlossene Form, kein Nachbau der Implementierung)
//   (b) Von Hand gerechnetes Momentum-Beispiel (12-1, Lueckenbalken beweisbar uebersprungen)
//   (c) Dezile 1..10 ueber die volle Kohorte, Residuum ist zentriert
//   (d) Unter dem Fenster -> null, NIE ein Ersatzwert; Coverage zaehlt die Nullen
//   (e) ZUKUNFTSBALKEN-LECK: Balken NACH dem Vintage-Datum duerfen den Wert nicht
//       beruehren. Die Probe bricht die Mauer einmal absichtlich (leaky-Referenz) und
//       belegt, dass die Fixture den Unterschied ueberhaupt sehen kann.
//   (f) Die Felder ueberleben --compact (deshalb Zeilen- statt pit-Ebene)
// Fixtures sind EINGEBETTET und hermetisch (eigener Temp-Baum, eigener Preis-Store).
// Run: node tests/board-history-pit-fields.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/write-board-history.js');
const priceStore = require('../lib/price-history-store.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const VOL_BARS = W._const.VOL_WINDOW_BARS;          // 60
const MOM_BARS = W._const.MOMENTUM_LOOKBACK_BARS;   // 250
const MOM_GAP = W._const.MOMENTUM_GAP_BARS;         // 21

// ── Fixture-Helfer ───────────────────────────────────────────────────────────
function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bhpit-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }

// Handelstage ab startDay aufsteigend (Wochenenden uebersprungen — nur damit die
// Fixture wie echte Balken aussieht; gerechnet wird ueber die BALKEN, nie ueber den Kalender).
function tradingDays(startDay, n) {
  const out = [];
  let ms = Date.parse(startDay + 'T00:00:00Z');
  while (out.length < n) {
    const d = new Date(ms);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    ms += 86400000;
  }
  return out;
}
// Serie aus expliziten Schlusskursen; das LETZTE Datum ist `lastDay`.
function seriesEndingAt(lastDay, closes) {
  const days = tradingDays('2023-01-02', closes.length + 4000).filter((d) => d <= lastDay);
  const tail = days.slice(days.length - closes.length);
  assert.strictEqual(tail.length, closes.length, 'Fixture: zu wenig Handelstage vor ' + lastDay);
  return tail.map((d, i) => ({ date: d, close: closes[i] }));
}
function writeStore(base, byTicker) {
  priceStore.saveAll(path.join(base, 'prices'), byTicker);
}
function boardRow(ticker, score) {
  return { ticker, score, track: 'profitable', scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7' };
}
function writeBoard(base, board, rows) {
  writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', board + '.json'), { profitable: rows, unprofitable: [] });
}
function readVintage(base, date, board) {
  return JSON.parse(fs.readFileSync(path.join(base, 'board-history', date, board + '.json'), 'utf8'));
}
function rowOf(v, ticker) {
  return v.cohort.profitable.concat(v.cohort.unprofitable).find((r) => r.ticker === ticker);
}
const NAH = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, msg + ' (ist ' + a + ', soll ' + b + ')');

// ── (a) Vol: von Hand gerechnet ──────────────────────────────────────────────
// Konstruktion: 61 Schlusskurse, deren Log-Returns exakt +s, -s, +s, ... sind (60 Stueck,
// 30 mal +s und 30 mal -s). Dann ist der Mittelwert 0 und JEDE Abweichung genau s, also
// SD(ddof=1) = s * sqrt(60/59). Das ist eine geschlossene Form, kein Nachbau des Codes.
check('(a) vol_60d = Stichproben-SD der letzten 60 Log-Returns (Handrechnung)', () => {
  const base = mkBase();
  const s = 0.02;
  const closes = [100];
  for (let i = 0; i < VOL_BARS; i++) closes.push(closes[closes.length - 1] * Math.exp(i % 2 === 0 ? s : -s));
  assert.strictEqual(closes.length, VOL_BARS + 1);
  const date = '2026-07-13';
  writeStore(base, { ABC: seriesEndingAt(date, closes) });
  writeBoard(base, 'semiconductors', [boardRow('ABC', 90)]);
  W.run({ baseDir: base, date });

  const r = rowOf(readVintage(base, date, 'semiconductors'), 'ABC');
  const soll = s * Math.sqrt(VOL_BARS / (VOL_BARS - 1));
  NAH(r.vol_60d, soll, 1e-12, 'vol_60d');
  assert.strictEqual(r.vol_decile, 1, 'einziger Wert der Kohorte -> Dezil 1');
});

// ── (b) Momentum: von Hand gerechnet, Lueckenbalken beweisbar uebersprungen ──
check('(b) momentum = ln(Kurs[t-21] / Kurs[t-250]), die Lueckenbalken zaehlen NICHT', () => {
  const base = mkBase();
  const n = MOM_BARS + 40;                    // reichlich Balken
  const closes = new Array(n).fill(100);
  closes[n - 1 - MOM_GAP] = 150;              // Zaehler des 12-1-Fensters
  closes[n - 1 - MOM_BARS] = 100;             // Nenner
  // Alles NACH dem Lueckenbalken wird absichtlich vergiftet: faende es den Weg in die
  // Formel, kaeme nie ln(1,5) heraus.
  for (let i = n - MOM_GAP; i < n; i++) closes[i] = 999;
  const date = '2026-07-13';
  writeStore(base, { ABC: seriesEndingAt(date, closes), DEF: seriesEndingAt(date, closes.map((c) => c * 2)) });
  writeBoard(base, 'semiconductors', [boardRow('ABC', 90), boardRow('DEF', 80)]);
  W.run({ baseDir: base, date });

  const v = readVintage(base, date, 'semiconductors');
  // Beide Ticker tragen dieselbe FORM (nur skaliert) -> identisches Roh-Momentum ln(1,5),
  // Kohorten-Mittel = ln(1,5), Residuum = 0 fuer beide.
  const a = rowOf(v, 'ABC');
  const b = rowOf(v, 'DEF');
  NAH(a.momentum_12m_residual, 0, 1e-12, 'Residuum bei identischem Roh-Momentum');
  NAH(b.momentum_12m_residual, 0, 1e-12, 'Residuum bei identischem Roh-Momentum');
  // Die Handrechnung selbst: Roh = Residuum + Kohorten-Mittel = 0 + ln(1,5).
  // Gegenprobe ueber die pure Funktion, damit der Rohwert nicht nur indirekt belegt ist.
  const f = W.pitPriceFeatures(seriesEndingAt(date, closes), date);
  NAH(f.momentumRaw, Math.log(1.5), 1e-12, 'momentumRaw');
});

// ── (c) Dezile 1..10 ueber die volle Kohorte + zentriertes Residuum ──────────
check('(c) Dezile decken 1..10 gleich besetzt ab; Momentum-Residuum ist zentriert', () => {
  const base = mkBase();
  const date = '2026-07-13';
  const store = {};
  const rows = [];
  // 20 Ticker mit streng monoton steigender Vol und streng steigendem Momentum.
  for (let k = 0; k < 20; k++) {
    const t = 'T' + String(k).padStart(2, '0');
    const s = 0.01 + k * 0.001;                          // Vol-Niveau
    const drift = 0.0005 * k;                            // Momentum-Niveau
    const n = MOM_BARS + 40;
    const closes = [100];
    for (let i = 1; i < n; i++) closes.push(closes[i - 1] * Math.exp(drift + (i % 2 === 0 ? s : -s)));
    store[t] = seriesEndingAt(date, closes);
    rows.push(boardRow(t, 90 - k));
  }
  writeStore(base, store);
  writeBoard(base, 'semiconductors', rows);
  W.run({ baseDir: base, date });

  const v = readVintage(base, date, 'semiconductors');
  const alle = v.cohort.profitable;
  const volDez = alle.map((r) => r.vol_decile).sort((x, y) => x - y);
  assert.deepStrictEqual(volDez, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10],
    '20 Zeilen -> je 2 pro Dezil, 1..10 vollstaendig');
  const momDez = alle.map((r) => r.momentum_12m_residual_decile).sort((x, y) => x - y);
  assert.deepStrictEqual(momDez, volDez, 'Momentum-Dezile decken 1..10 genauso ab');
  // Monotonie: hoechste Vol -> Dezil 10.
  const maxVol = alle.reduce((a, r) => (r.vol_60d > a.vol_60d ? r : a));
  assert.strictEqual(maxVol.vol_decile, 10, 'groesste Vol liegt im obersten Dezil');
  // Zentrierung: Summe der Residuen ueber alle nicht-null Zeilen = 0.
  const summe = alle.reduce((a, r) => a + (r.momentum_12m_residual || 0), 0);
  NAH(summe, 0, 1e-9, 'Summe der Momentum-Residuen');
  assert.strictEqual(v.pitFieldCoverage.vol_decile, 1, 'Coverage voll');
  assert.strictEqual(v.pitFieldCoverage.momentum_12m_residual_decile, 1, 'Coverage voll');
});

// ── (d) Unter dem Fenster -> null, nie ein Ersatzwert ────────────────────────
check('(d) zu kurze Historie -> null (Wert UND Dezil), pitFieldCoverage zaehlt die Nullen', () => {
  const base = mkBase();
  const date = '2026-07-13';
  const lang = MOM_BARS + 10;
  const bauen = (n, s) => {
    const closes = [100];
    for (let i = 1; i < n; i++) closes.push(closes[i - 1] * Math.exp(i % 2 === 0 ? s : -s));
    return seriesEndingAt(date, closes);
  };
  writeStore(base, {
    LANG: bauen(lang, 0.02),                    // beides vorhanden
    MITTE: bauen(VOL_BARS + 1, 0.03),           // genau 61 Schlusskurse -> Vol ja, Momentum nein
    KURZ: bauen(VOL_BARS, 0.03),                // 60 Schlusskurse = 59 Returns -> beides nein
    // KEIN Eintrag fuer OHNE: Ticker ohne jede Preis-Historie
  });
  writeBoard(base, 'semiconductors', [boardRow('LANG', 90), boardRow('MITTE', 80), boardRow('KURZ', 70), boardRow('OHNE', 60)]);
  W.run({ baseDir: base, date });

  const v = readVintage(base, date, 'semiconductors');
  const lg = rowOf(v, 'LANG'); const mi = rowOf(v, 'MITTE'); const kz = rowOf(v, 'KURZ'); const oh = rowOf(v, 'OHNE');
  assert.ok(lg.vol_60d > 0 && lg.momentum_12m_residual != null, 'volle Historie traegt beides');
  assert.ok(mi.vol_60d > 0, '61 Schlusskurse reichen fuer Vol');
  assert.strictEqual(mi.momentum_12m_residual, null, 'unter 251 Schlusskursen kein Momentum');
  assert.strictEqual(mi.momentum_12m_residual_decile, null, 'und auch kein Momentum-Dezil');
  assert.strictEqual(kz.vol_60d, null, '60 Schlusskurse = 59 Returns -> kein Vol');
  assert.strictEqual(kz.vol_decile, null, 'und kein Vol-Dezil');
  assert.strictEqual(oh.vol_60d, null, 'ohne Historie kein Wert');
  assert.strictEqual(oh.vol_decile, null, 'ohne Historie kein Dezil');
  // JEDE Zeile traegt die Schluessel, auch die leeren (ein fehlender Schluessel waere von
  // "Feld gibt es nicht" nicht zu unterscheiden).
  for (const r of v.cohort.profitable) {
    for (const f of ['vol_60d', 'vol_decile', 'momentum_12m_residual', 'momentum_12m_residual_decile']) {
      assert.ok(Object.prototype.hasOwnProperty.call(r, f), r.ticker + ' traegt ' + f);
    }
  }
  assert.strictEqual(v.pitFieldCoverage.vol_decile, 2 / 4, 'Vol-Coverage 2 von 4');
  assert.strictEqual(v.pitFieldCoverage.momentum_12m_residual_decile, 1 / 4, 'Momentum-Coverage 1 von 4');
});

// ── (e) ZUKUNFTSBALKEN-LECK ─────────────────────────────────────────────────
// Der Store ist eine LEBENDE Datei: beim Nachrechnen eines aelteren Vintages liegen
// Balken von NACH dem Stichtag darin. Sie duerfen den Wert nicht anfassen.
check('(e) Balken nach dem Vintage-Datum aendern nichts — und die Fixture wuerde es sehen', () => {
  const base = mkBase();
  const date = '2026-05-15';       // Stichtag liegt VOR dem Ende des Stores
  const n = MOM_BARS + 40;
  const closes = [100];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * Math.exp(i % 2 === 0 ? 0.02 : -0.02));
  const bisStichtag = seriesEndingAt(date, closes);
  // 30 Zukunftsbalken mit voellig anderem Charakter (ruhig + Kurssprung) anhaengen.
  const spaeter = tradingDays('2026-05-18', 30).map((d, i) => ({ date: d, close: 500 + i }));
  const mitZukunft = bisStichtag.concat(spaeter);
  assert.ok(spaeter[0].date > date, 'Fixture: Zusatzbalken liegen wirklich nach dem Stichtag');

  // DIE PROBE BRICHT DIE MAUER EINMAL ABSICHTLICH: dieselbe Funktion, aber mit einem
  // Stichtag, der die Zukunftsbalken einschliesst. Kaeme derselbe Wert heraus, waere die
  // Fixture blind und der Test wertlos.
  const leck = W.pitPriceFeatures(mitZukunft, spaeter[spaeter.length - 1].date);
  const sauber = W.pitPriceFeatures(mitZukunft, date);
  const nurBisStichtag = W.pitPriceFeatures(bisStichtag, date);
  assert.ok(Math.abs(leck.vol60d - sauber.vol60d) > 1e-6, 'Gegenprobe: ohne Mauer kaeme ein ANDERER Vol-Wert');
  assert.ok(Math.abs(leck.momentumRaw - sauber.momentumRaw) > 1e-6, 'Gegenprobe: ohne Mauer kaeme ein ANDERES Momentum');
  // Und das ist die Mauer selbst: mit Zukunftsbalken im Store faellt exakt derselbe Wert
  // wie ohne sie.
  assert.strictEqual(sauber.vol60d, nurBisStichtag.vol60d, 'Vol identisch mit/ohne Zukunftsbalken');
  assert.strictEqual(sauber.momentumRaw, nurBisStichtag.momentumRaw, 'Momentum identisch mit/ohne Zukunftsbalken');

  // Ende-zu-Ende ueber den Schreibpfad, damit die Mauer nicht nur in der puren Funktion haelt.
  writeStore(base, { ABC: mitZukunft });
  writeBoard(base, 'semiconductors', [boardRow('ABC', 90)]);
  W.run({ baseDir: base, date });
  const r = rowOf(readVintage(base, date, 'semiconductors'), 'ABC');
  assert.strictEqual(r.vol_60d, nurBisStichtag.vol60d, 'geschriebenes vol_60d kennt nur Balken bis zum Stichtag');
  assert.ok(Math.abs(r.vol_60d - leck.vol60d) > 1e-6, 'geschriebener Wert ist NICHT der Leck-Wert');
});

// ── (f) Die Felder ueberleben --compact ─────────────────────────────────────
// Begruendung der Zeilen-Ebene: compact() strippt den pit-Block nach ~2Q (A12); der erste
// LT1-Read liegt Jahre spaeter. Laegen die Matching-Felder in pit, waeren sie dann weg.
check('(f) vol/momentum-Felder ueberleben die Kompaktierung (pit wird gestrippt)', () => {
  const base = mkBase();
  const RET = W._const.RETENTION_DAYS;
  const today = '2026-07-13';
  const alt = new Date(Date.parse(today + 'T00:00:00Z') - (RET + 10) * 86400000).toISOString().slice(0, 10);
  const n = MOM_BARS + 40;
  const closes = [100];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * Math.exp(i % 2 === 0 ? 0.02 : -0.02));
  writeStore(base, { ABC: seriesEndingAt(alt, closes) });
  writeBoard(base, 'semiconductors', [boardRow('ABC', 90)]);
  W.run({ baseDir: base, date: alt });
  const vorher = rowOf(readVintage(base, alt, 'semiconductors'), 'ABC');
  assert.ok(vorher.vol_60d > 0 && vorher.vol_decile === 1, 'Vintage traegt die Felder vor der Kompaktierung');

  const res = W.run({ baseDir: base, compact: true, date: today });
  assert.ok(res.compacted.length >= 1, 'mindestens 1 Vintage kompaktiert');
  const nachher = rowOf(readVintage(base, alt, 'semiconductors'), 'ABC');
  assert.strictEqual(nachher.pit, undefined, 'pit ist gestrippt (unveraendertes A12-Verhalten)');
  assert.strictEqual(nachher.vol_60d, vorher.vol_60d, 'vol_60d bleibt');
  assert.strictEqual(nachher.vol_decile, 1, 'vol_decile bleibt');
  assert.strictEqual(nachher.momentum_12m_residual, vorher.momentum_12m_residual, 'Momentum-Residuum bleibt');
  assert.strictEqual(nachher.momentum_12m_residual_decile, vorher.momentum_12m_residual_decile, 'Momentum-Dezil bleibt');
});

// ── (g) Halber Preis-Store -> LAUT, nicht still genullt ─────────────────────
// Nachgestellter Fall (Review 19.09., beide Pruefer unabhaengig): loadShard() liefert fuer
// eine FEHLENDE Shard-Datei {} — ohne Wache wird aus einem echten vol_60d ein null, das in
// der committeten Messreihe fuer immer wie "hat keine 12 Monate Historie" aussieht.
check('(g) fehlender Preis-Shard bricht den Lauf ab, statt still null zu schreiben', () => {
  const base = mkBase();
  const date = '2026-07-13';
  const n = MOM_BARS + 40;
  const closes = [100];
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * Math.exp(i % 2 === 0 ? 0.02 : -0.02));
  writeStore(base, { ABC: seriesEndingAt(date, closes) });
  writeBoard(base, 'semiconductors', [boardRow('ABC', 90)]);
  // Erst der Beweis, dass der vollstaendige Store einen ECHTEN Wert liefert …
  W.run({ baseDir: base, date });
  const gut = rowOf(readVintage(base, date, 'semiconductors'), 'ABC');
  assert.ok(gut.vol_60d > 0, 'vollstaendiger Store liefert einen Wert');

  // … dann genau den Shard von ABC entfernen (halber Checkout) und erneut schreiben.
  fs.rmSync(path.join(base, 'board-history'), { recursive: true, force: true });
  fs.unlinkSync(priceStore.shardPath(path.join(base, 'prices'), priceStore.shardOf('ABC')));
  assert.throws(() => W.run({ baseDir: base, date }), /Preis-Store unvollstaendig/,
    'halber Store muss werfen, nicht stillschweigend nullen');
  assert.ok(!fs.existsSync(path.join(base, 'board-history', date)), 'und kein Vintage schreiben');

  // Gegenrichtung: GAR KEIN Store ist kein Fehler (hermetische Laeufe) — dann ist null ehrlich.
  const leer = mkBase();
  writeBoard(leer, 'semiconductors', [boardRow('ABC', 90)]);
  W.run({ baseDir: leer, date });
  const ohne = rowOf(readVintage(leer, date, 'semiconductors'), 'ABC');
  assert.strictEqual(ohne.vol_60d, null, 'ohne Store: null, ohne Wurf');
  assert.strictEqual(readVintage(leer, date, 'semiconductors').pitFieldCoverage.vol_decile, 0);
});

console.log(fail ? ('\nFAIL: ' + fail + ' Test(s)') : '\nAlle LT1-PIT-Feld-Tests gruen');
process.exit(fail ? 1 : 0);
