'use strict';
/**
 * tests/dt1-adapter-zeitbudget.test.js — Waechter fuer DT-1 (Verifikation Exchange-Kanal
 * 2026-08-04, Lauf 30788278952 / prep-Job 91606250192).
 *
 * BEFUND: der Schritt "Refresh Universe" lief in sein 20-Minuten-Timeout und
 * watchlist.json wurde gar nicht erst geschrieben. Verursacher waren NICHT die
 * Yahoo-Kanaele (1m44s bzw. ~0s), sondern zwei Discovery-Adapter mit seriellen
 * Retry-Leitern, deren WORST CASE ALLEIN schon ueber dem Schritt-Timeout liegt:
 *   otc-markets.js  10 Seiten x 3 Versuchen x 30s + [10s,30s] Backoff = 21m45s
 *   nasdaq-api.js    3 Boersen x 3 Versuchen x 45s + [15s,45s] Backoff =  9m47s
 * Gemessen: 18m28s in dieser Schleife, Tod mitten in OTC-Seite 9 (8 volle Seiten
 * = 1044s plus 64s in der neunten) — die Rechnung deckt sich mit dem Log.
 *
 * FIX: ein Gesamt-Zeitbudget JE ADAPTER (discovery/zeitbudget.js), hergeleitet aus dem
 * timeout-minutes des Workflow-Schritts. Reisst ein Adapter sein Budget, gibt er auf,
 * meldet laut (::error::) und ZAEHLBAR (partial/budgetRiss auf der Map, die
 * refresh-universe.js bereits als "Discovery Teilausfall" liest) — und die anderen
 * Adapter laufen weiter.
 *
 * Geprueft wird das VERHALTEN mit injizierter Uhr und injiziertem Holer: kein Netz,
 * keine echte Wartezeit, aber der ECHTE Schleifen- und Leitercode der Adapter.
 * Anwesenheit UND Abwesenheit: Riss -> laut + zaehlbar, im Budget -> still.
 *
 * Run: node tests/dt1-adapter-zeitbudget.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const zb = require('../discovery/zeitbudget.js');
const otc = require('../discovery/otc-markets.js');
const nas = require('../discovery/nasdaq-api.js');

let pass = 0, fail = 0;
function test(name, fn) {
  const p = fn();
  const fertig = () => { pass++; console.log('  ok   ' + name); };
  const kaputt = (e) => { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message || e)); };
  return (p && typeof p.then === 'function') ? p.then(fertig, kaputt) : (fertig(), Promise.resolve());
}

/** console.error/warn mitschneiden, damit "laut" messbar ist statt behauptet. */
function mitLog(fn) {
  const zeilen = [];
  const eAlt = console.error, wAlt = console.warn, lAlt = console.log;
  console.error = (...a) => zeilen.push(a.join(' '));
  console.warn = (...a) => zeilen.push(a.join(' '));
  console.log = () => {};
  const zurueck = () => { console.error = eAlt; console.warn = wAlt; console.log = lAlt; };
  let r;
  try { r = fn(); } catch (e) { zurueck(); throw e; }
  if (r && typeof r.then === 'function') {
    return r.then((v) => { zurueck(); return { wert: v, log: zeilen.join('\n') }; },
      (e) => { zurueck(); throw e; });
  }
  zurueck();
  return Promise.resolve({ wert: r, log: zeilen.join('\n') });
}

/** Eine stellbare Uhr: jede Anfrage kostet genau `kostenMs` Millisekunden. */
function uhrwerk(startMs) {
  let jetzt = startMs || 0;
  return { lies: () => jetzt, vor: (ms) => { jetzt += ms; } };
}

const otcSeite = (n) => JSON.stringify({
  stocks: {
    rows: Array.from({ length: n }, (_, i) => ({ symbol: 'AA' + String.fromCharCode(65 + i), companyName: 'Firma ' + i })),
    totalRecords: 999999,   // nie erreichbar -> die Paginierung endet nur am Budget oder MAX_PAGES
  },
});
const nasdaqAntwort = JSON.stringify({
  data: { table: { rows: [{ symbol: 'AAA', name: 'Alpha', marketCap: '$1.2B', sector: 'Tech' }] } },
});

const timeoutFehler = (url) => { const e = new Error('timeout fetching ' + url); return e; };

(async () => {

// ── Herleitung: das Budget haengt am Workflow, nicht an einer gegriffenen Zahl ────
await test('DT-1: SCHRITT_TIMEOUT_MIN ist das timeout-minutes des Refresh-Schritts', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  // Tag 660: vorher stand hier ein Zeichenfenster (`[\s\S]{0,600}?`). Es ist gerissen, als
  // dem Schritt drei env-Zeilen mit Begruendung hinzugefuegt wurden — timeout-minutes rutschte
  // ueber die 600 Zeichen hinaus, und der Test meldete "nicht gefunden", obwohl es unveraendert
  // dastand. Die SACHE hatte sich nicht geaendert, nur der Abstand. Ein Fenster ist eine
  // Annahme ueber die Schreibweise, keine ueber den Gegenstand — also am OBJEKT suchen:
  // den Block dieses Schritts nehmen (bis zum naechsten "- name:") und darin lesen.
  // Dasselbe Muster wie pullSchritte() in refresh-universe.test.js (T562-L1).
  const bloecke = yml.split(/^ {6}- name: /m).filter((b) => b.startsWith('Refresh Universe'));
  assert.equal(bloecke.length, 1,
    bloecke.length + ' Schritte beginnen mit "Refresh Universe" — dann ist nicht mehr eindeutig, '
    + 'welches timeout-minutes gemeint ist.');
  const m = bloecke[0].match(/^\s*timeout-minutes:\s*(\d+)\s*$/m);
  assert.ok(m, 'Schritt "Refresh Universe" oder sein timeout-minutes nicht gefunden');
  assert.equal(zb.SCHRITT_TIMEOUT_MIN, Number(m[1]),
    'discovery/zeitbudget.js rechnet mit ' + zb.SCHRITT_TIMEOUT_MIN + ' Minuten, der Workflow-Schritt '
    + 'traegt aber timeout-minutes: ' + m[1] + '. Dann ist das Budget nicht mehr hergeleitet, sondern '
    + 'geraten — und genau das war der Befund (eine Leiter, die den Schritt ueberdauert).');
});

await test('DT-1: die Budget-SUMME plus Reserve bleibt unter dem Schritt-Timeout', () => {
  const schrittMs = zb.SCHRITT_TIMEOUT_MIN * 60 * 1000;
  const summe = zb.ADAPTER_BUDGET_MS * zb.BUDGETIERTE_ADAPTER;
  const reserve = schrittMs * zb.NICHT_ADAPTER_RESERVE_ANTEIL;
  assert.ok(summe + reserve <= schrittMs,
    'Summe aller Adapter-Budgets (' + summe / 1000 + 's) + Reserve (' + reserve / 1000 + 's) uebersteigt '
    + 'das Schritt-Timeout (' + schrittMs / 1000 + 's) — dann kann der Schritt trotz Budgets sterben.');
  assert.ok(reserve >= 105000,
    'die Reserve fuer alles ausser den budgetierten Adaptern (' + reserve / 1000 + 's) liegt unter dem '
    + 'GEMESSENEN Nicht-Adapter-Anteil vom 03.08. (Predefined 104s + Exchange ~1s, ohne Prefilter/Write).');
});

await test('DT-1: die ALTE Leiter haette das Schritt-Timeout allein gerissen (der Befund)', () => {
  // Am IST-Code nachgerechnet, nicht aus dem Gedaechtnis: die Konstanten kommen aus den
  // Adapter-Quellen. Faellt eine Leiter kuenftig unter das Schritt-Timeout, ist dieser
  // Test rot — dann stimmt die Begruendung des Budgets nicht mehr und gehoert angefasst.
  const src = fs.readFileSync(path.join(ROOT, 'discovery', 'otc-markets.js'), 'utf8');
  const sock = Number(src.match(/req\.setTimeout\((\d+),/)[1]);
  const delays = src.match(/const RETRY_DELAYS = \[([\d, ]+)\]/)[1].split(',').map(Number);
  const seiten = Number(src.match(/const MAX_PAGES = (\d+)/)[1]);
  const pause = Number(src.match(/const PAGE_DELAY_MS = (\d+)/)[1]);
  const proSeite = (delays.length + 1) * sock + delays.reduce((a, b) => a + b, 0) + pause;
  const gesamt = seiten * proSeite;
  assert.equal(proSeite, 130500, 'OTC-Leiter je Seite: ' + proSeite + 'ms (erwartet 130500 = 3x30s + 10s + 30s + 500ms)');
  assert.ok(gesamt > zb.SCHRITT_TIMEOUT_MIN * 60 * 1000,
    'die ungedeckelte OTC-Leiter (' + gesamt / 1000 + 's) laege unter dem Schritt-Timeout — dann bildet '
    + 'dieser Test den Befund nicht mehr ab.');
  assert.ok(zb.ADAPTER_BUDGET_MS < gesamt,
    'das Adapter-Budget (' + zb.ADAPTER_BUDGET_MS / 1000 + 's) deckelt die Leiter (' + gesamt / 1000 + 's) nicht.');
});

// ── mitBudget: die Leiter wird vom Budget geschlagen, nicht umgekehrt ─────────────
await test('DT-1: mitBudget bricht ab, statt einen Backoff zu nehmen, der nicht mehr passt', async () => {
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('Probe', 35000, u.lies);
  let versuche = 0;
  const e = await mitBudget_erwarteWurf(budget, () => { versuche++; u.vor(30000); throw timeoutFehler('x'); });
  assert.equal(e.budgetRiss, true,
    'nach dem ersten 30s-Timeout passt der 10s-Backoff plus ein weiterer Versuch nicht mehr in ein '
    + '35s-Budget — der Adapter muss hier aufgeben statt die Leiter zu Ende zu gehen.');
  assert.equal(versuche, 1, 'die Leiter lief weiter (' + versuche + ' Versuche) — genau das kostete am 03.08. 18m28s.');
});

await test('DT-1: mitBudget faengt gar nicht erst an, wenn das Budget schon erschoepft ist', async () => {
  // Das ist die Pruefung, die den ADAPTER stoppt: der Riss der vorigen Seite/Boerse hat das
  // Budget aufgebraucht, der naechste Aufruf darf keine neue 130s-Leiter mehr starten. Ohne
  // sie liefe der Adapter weiter, bis MAX_PAGES erreicht ist — also genau die 21m45s.
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('Probe', 10000, u.lies);
  u.vor(20000);   // Budget ist bereits ueberzogen
  let versuche = 0;
  const e = await mitBudget_erwarteWurf(budget, () => { versuche++; return Promise.resolve('x'); });
  assert.equal(e.budgetRiss, true, 'ein erschoepftes Budget laesst noch eine Anfrage zu: ' + e.message);
  assert.equal(versuche, 0, 'die Anfrage wurde trotz erschoepftem Budget gestellt (' + versuche + 'x) — '
    + 'jede weitere Anfrage kann bis zum vollen Socket-Timeout dauern.');
});

await test('DT-1: im Budget laeuft die Leiter unveraendert zu Ende (Gegenprobe, kein Falsch-Abbruch)', async () => {
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('Probe', 600000, u.lies);
  let versuche = 0;
  const e = await mitBudget_erwarteWurf(budget, () => { versuche++; u.vor(30000); throw timeoutFehler('x'); },
    (ms) => { u.vor(ms); return Promise.resolve(); });
  assert.ok(!e.budgetRiss, 'ein grosszuegiges Budget bricht die Leiter ab — dann ist das Budget ein '
    + 'Falsch-Abbruch-Generator: ' + e.message);
  assert.equal(versuche, 3, 'die volle Leiter (3 Versuche) muss im Budget erhalten bleiben, nicht ' + versuche);
});

function mitBudget_erwarteWurf(budget, anfrage, schlafen) {
  return zb.mitBudget(budget, 'Probe', [10000, 30000], () => true, anfrage, schlafen || (() => Promise.resolve()))
    .then(() => { throw new Error('mitBudget hat nicht geworfen'); }, (e) => e);
}

// ── otc-markets: Riss -> laut + zaehlbar · im Budget -> still ─────────────────────
await test('DT-1 otc-markets: Budget-Riss meldet laut UND zaehlbar, liefert den Teilbestand', async () => {
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('OTC-Markets', 300000, u.lies);
  let seiten = 0;
  const { wert: map, log } = await mitLog(() => otc.fetchOTCMarkets({
    budget,
    holen: () => { seiten++; u.vor(130000); return Promise.resolve(otcSeite(3)); },
  }));
  assert.ok(seiten >= 1 && seiten < 10, 'der Adapter hat ' + seiten + ' Seiten geholt — bei 300s Budget und '
    + '130s je Seite muessen es 2-3 sein, nie alle 10.');
  assert.match(log, /::error::/, 'der Riss meldet sich nicht in Karls Kanal — ein stiller Teilausfall ist '
    + 'genau der Zustand, den DT-1 abschafft.');
  assert.match(log, /ZEITBUDGET GERISSEN/, 'die Meldung benennt die Ursache nicht.');
  assert.equal(map.partial, true, 'die zurueckgegebene Map traegt kein `partial` — refresh-universe.js '
    + 'listet den Teilausfall dann nicht unter "Discovery Teilausfaelle" und .size sieht wie Erfolg aus.');
  assert.equal(map.budgetRiss, true, 'kein `budgetRiss`-Stempel — der Ausfall ist nicht als Budget-Fall zaehlbar.');
  assert.ok(map.size > 0, 'der Teilbestand ging verloren — was schon geholt wurde, gehoert zurueckgegeben.');
});

await test('DT-1 otc-markets: im Budget bleibt alles still (Gegenprobe)', async () => {
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('OTC-Markets', 300000, u.lies);
  const kurz = JSON.stringify({ stocks: { rows: [{ symbol: 'AAA', companyName: 'Alpha' }], totalRecords: 1 } });
  const { wert: map, log } = await mitLog(() => otc.fetchOTCMarkets({
    budget, holen: () => { u.vor(1500); return Promise.resolve(kurz); },
  }));
  assert.ok(!/::error::/.test(log), 'ein gesunder Lauf meldet einen Fehler: ' + log);
  assert.ok(!map.partial, 'ein gesunder Lauf wird als Teilausfall gestempelt — Dauer-Falschalarm.');
  assert.ok(!map.budgetRiss, 'ein gesunder Lauf traegt den Budget-Riss-Stempel.');
  assert.equal(map.size, 1, 'der gesunde Lauf liefert nicht mehr die Tickers: ' + map.size);
});

// ── nasdaq-api: dieselbe Wurzel, dieselbe Wache ──────────────────────────────────
await test('DT-1 nasdaq-api: Budget-Riss meldet laut UND zaehlbar', async () => {
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('NASDAQ-API', 300000, u.lies);
  let boersen = 0;
  const { wert: map, log } = await mitLog(() => nas.fetchNasdaqApiList({
    budget,
    holen: () => { boersen++; u.vor(195000); return Promise.resolve(nasdaqAntwort); },
  }));
  assert.ok(boersen >= 1 && boersen < 3, 'der Adapter hat ' + boersen + ' Boersen geholt — bei 300s Budget '
    + 'und 195s je Boerse duerfen es nicht alle drei sein.');
  assert.match(log, /::error::/, 'der Riss meldet sich nicht in Karls Kanal.');
  assert.equal(map.partial, true, 'die Map traegt kein `partial` — nasdaq-api hat den Stempel bis DT-1 '
    + 'ueberhaupt nie gesetzt, ein Teilausfall war von einem vollen Abzug nicht zu unterscheiden.');
  assert.equal(map.budgetRiss, true, 'kein `budgetRiss`-Stempel.');
});

await test('DT-1 nasdaq-api: im Budget bleibt alles still (Gegenprobe)', async () => {
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('NASDAQ-API', 300000, u.lies);
  const { wert: map, log } = await mitLog(() => nas.fetchNasdaqApiList({
    budget, holen: () => { u.vor(2000); return Promise.resolve(nasdaqAntwort); },
  }));
  assert.ok(!/::error::/.test(log), 'ein gesunder Lauf meldet einen Fehler: ' + log);
  assert.ok(!map.partial, 'ein gesunder Lauf wird als Teilausfall gestempelt — Dauer-Falschalarm.');
  assert.equal(map.size, 1, 'der gesunde Lauf liefert nicht die erwarteten Tickers: ' + map.size);
});

await test('DT-1 nasdaq-api: ein gescheiterter Boersen-Abzug ist zaehlbar (nicht nur eine Logzeile)', async () => {
  const u = uhrwerk(0);
  const budget = zb.zeitbudget('NASDAQ-API', 3000000, u.lies);   // Budget reicht dick
  let n = 0;
  const { wert: map } = await mitLog(() => nas.fetchNasdaqApiList({
    budget,
    holen: () => {
      n++;
      u.vor(2000);
      if (n === 1) return Promise.reject(new Error('HTTP 403 from api.nasdaq.com'));
      return Promise.resolve(nasdaqAntwort);
    },
  }));
  assert.equal(map.partial, true, 'eine ausgefallene Boerse hinterlaesst kein Signal auf der Map — der '
    + 'Aufrufer sieht an .size einen glatten Erfolg, obwohl ein Drittel fehlt (Klasse BH-058).');
  assert.equal(map.size, 1, 'die uebrigen Boersen wurden nicht weitergezogen: ' + map.size);
});

console.log('\ndt1-adapter-zeitbudget.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

})().catch((e) => { console.error('ABBRUCH: ' + (e && e.stack || e)); process.exit(1); });
