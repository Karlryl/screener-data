'use strict';
/**
 * Waechter fuer die Groessen-Sichtbarkeit in der Hypergrowth-Uebersicht.
 *
 * ⚠ UMGESTELLT 02.08.2026 — KARL-ENTSCHEID, bindend: die Mega-Cap-Grenze faellt ERSATZLOS
 * und wird durch fuenf Groessen-Kohorten (Reiter mit verschiebbaren Grenzen) ersetzt.
 *
 * WAS VORHER HIER STAND: sieben Tests, die den Uebersichts-Filter festnagelten (Tag 468,
 * Karl-Korrektur 27.07. von 22,7 Mrd. auf 200 Mrd.). Sie pinnten eine Einrichtung, die es
 * nicht mehr gibt — ihr Entfernen ist Nachziehen, kein Abschwaechen.
 *
 * WAS NICHT VERLOREN GEHEN DURFTE: der Test "Karls Kernnamen bleiben in der Uebersicht"
 * trug die Begruendung "Faellt dieser Test, ist Karls Screener wieder ein Small-Cap-Screener."
 * Diese Zusage ist staerker geworden, nicht schwaecher: frueher hiess sie "CRDO/ALAB/BE sind
 * drin, NVDA/TSM/AVGO draussen", jetzt heisst sie "KEINE Firma faellt wegen ihrer Groesse aus
 * der Uebersicht, und jede landet in der richtigen Kohorte". Sie steht unten als
 * 'niemand verschwindet mehr wegen seiner Groesse'.
 *
 * Die beiden Klassifikations-Tests am Ende pinnen die fuenf Kohortengrenzen. Sie waren vorher
 * schon da und sind jetzt der wichtigste Teil der Datei — ohne sie gibt es keine Reiter.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const score = require('../../src/scoring/score.js');
const { produceRankings, mcapKlasseOf } = score;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const zeile = (ticker, score, marketCap) => ({
  ticker, action: 'route', score, track: 'profitable', formulaId: 'semiconductors',
  lamps: [], overview: { kind: 'gp', value: 0.5, companion: 100 }, marketCap,
  mcapKlasse: mcapKlasseOf(marketCap),
});

test('niemand verschwindet mehr wegen seiner Groesse — und jeder landet in seiner Kohorte', () => {
  // Echte Marktwerte vom 27.07.2026. Vorher: die drei Riesen wurden aus der Uebersicht
  // gefiltert. Jetzt stehen alle sechs drin, unterscheidbar nach Kohorte.
  const echt = [
    zeile('NVDA', 99, 5009.87e9),
    zeile('TSM', 98, 2066.14e9),
    zeile('AVGO', 97, 1817.02e9),
    zeile('BE', 96, 52.59e9),
    zeile('ALAB', 95, 49.98e9),
    zeile('CRDO', 94, 39.75e9),
  ];
  const r = produceRankings(echt, { topN: 10 });
  const t = r.overview.map((x) => x.ticker);
  assert.deepEqual(t, ['NVDA', 'TSM', 'AVGO', 'BE', 'ALAB', 'CRDO'],
    'alle sechs muessen in der Uebersicht stehen — keine Groessen-Aussortierung mehr');
  const kl = Object.fromEntries(r.overview.map((x) => [x.ticker, x.mcapKlasse]));
  assert.equal(kl.NVDA, 'mega'); assert.equal(kl.TSM, 'mega'); assert.equal(kl.AVGO, 'mega');
  assert.equal(kl.BE, 'large'); assert.equal(kl.ALAB, 'large'); assert.equal(kl.CRDO, 'large');
});

test('kein Aufruf-Parameter kann die Uebersicht noch nach Groesse beschneiden', () => {
  // Waechter an der SACHE, nicht am Schreibstil: selbst wenn jemand den alten Parameter
  // wieder mitgibt, darf keine Zeile verschwinden. Ohne diesen Anker koennte die Grenze
  // still zurueckkehren, indem irgendein Aufrufer sie wieder setzt.
  const echt = [zeile('RIESE', 99, 5000e9), zeile('KLEIN', 98, 1e9)];
  for (const opts of [{ topN: 10 }, { topN: 10, overviewMaxMcap: 200e9 }, { topN: 10, overviewMaxMcap: 1e9 }]) {
    const r = produceRankings(echt, opts);
    assert.deepEqual(r.overview.map((x) => x.ticker), ['RIESE', 'KLEIN'],
      'Groessen-Beschneidung bei opts=' + JSON.stringify(opts));
  }
});

test('die Grenze ist auch aus dem Aufrufer verschwunden, nicht nur aus der Engine', () => {
  // Sonst waere sie nur umgezogen: score.js filtert nicht mehr, run-screener.js setzt aber
  // weiter eine Obergrenze. Geprueft wird der Aufrufer selbst, nicht ein Kommentar darin.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'scoring', 'run-screener.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/MEGA_CAP_USD/.test(code), 'run-screener.js verweist noch auf MEGA_CAP_USD');
  assert.ok(!/overviewMaxMcap/.test(code), 'run-screener.js setzt noch overviewMaxMcap');
  assert.equal(score.MEGA_CAP_USD, undefined, 'score.js exportiert MEGA_CAP_USD noch');
});

test('die absolute Groessenklasse trennt, was die gelernte zusammenwirft', () => {
  // Am 27.07. gemessen: die gelernten Grenzen lagen bei 2,47 / 3,89 / 7,02 / 17,02 Mrd. —
  // CRDO (39,8) und NVIDIA (5.010) fielen BEIDE in dieselbe oberste gelernte Klasse, obwohl
  // zwischen ihnen der Faktor 126 liegt. Genau das war Karls Kritik an mcapBand, und genau
  // das ist der Grund, warum die Reiter auf mcapKlasse stehen und nicht auf mcapBand.
  assert.equal(mcapKlasseOf(39.75e9), 'large', 'CRDO ist ein Large Cap');
  assert.equal(mcapKlasseOf(49.98e9), 'large', 'ALAB ist ein Large Cap');
  assert.equal(mcapKlasseOf(5009.87e9), 'mega', 'NVIDIA ist ein Mega Cap');
  // Die fuenf Kohortengrenzen, jeweils knapp darunter und darauf.
  assert.equal(mcapKlasseOf(299e6), 'micro');
  assert.equal(mcapKlasseOf(300e6), 'small');
  assert.equal(mcapKlasseOf(1.99e9), 'small');
  assert.equal(mcapKlasseOf(2e9), 'mid');
  assert.equal(mcapKlasseOf(9.99e9), 'mid');
  assert.equal(mcapKlasseOf(10e9), 'large');
  assert.equal(mcapKlasseOf(199e9), 'large');
  assert.equal(mcapKlasseOf(200e9), 'mega');
});

test('die Groessenklasse erfindet nichts, wo kein Marktwert ist', () => {
  // Number(null) ist 0, Number('kaputt') ist NaN. Beides darf keine Klasse ergeben —
  // eine erfundene "micro"-Einstufung waere schlimmer als keine, weil der Reiter sie zeigt.
  assert.equal(mcapKlasseOf(null), null);
  assert.equal(mcapKlasseOf(undefined), null);
  assert.equal(mcapKlasseOf('nicht-lesbar'), null);
  assert.equal(mcapKlasseOf(0), null);
  assert.equal(mcapKlasseOf(-5e9), null);
});

console.log(`\nuebersicht-largecap: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
