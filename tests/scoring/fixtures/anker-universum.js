'use strict';
/**
 * Gemeinsamer Fixture-Bauer fuer die beiden hermetischen Anker-Waechter
 * (anchors.rank.rumpf-skip.test.js und anchors.rank.exitcode.test.js).
 *
 * Baut ein synthetisches Universum aus den eingefrorenen Anker-Snapshots plus Fuellern,
 * gross genug fuer das >=100-Datei-Gate von anchors.rank.test.js und fett genug, dass die
 * Kohorten ranking-faehig sind (semiconductors > topN, sonst beisst der A8-Test nicht).
 *
 * Bis Tag 977 lag dieser Bauer als 70-Zeilen-Kopie in rumpf-skip; die zweite Testdatei
 * haette ihn ein zweites Mal dupliziert. Liegt in fixtures/, damit test-gate.js ihn nicht
 * als ungegatete Testdatei zaehlt (listRepoTestFiles filtert '/fixtures/').
 */
const fs = require('node:fs');
const path = require('node:path');

const FIX = __dirname;
const ladeFixture = (t) => JSON.parse(fs.readFileSync(path.join(FIX, t + '.json'), 'utf8'));

// Degradierter Klon eines eingefrorenen Anker-Snapshots: gleiche Branche/Track/Waehrung (routet
// identisch), aber per Klon variiertes Wachstum -> Wachstums-Achsen-Perzentile unter (bzw. bei
// grossem g ueber) dem Anker. gm<0.55 + konstante opMargin -> kein newestQtrSuspect; USD/USD ->
// kein annualCurrencyLeak; distinct meta.name -> kein issuer-dedup; newest annualOpInc>0 ->
// profitable-Track.
function fillerFrom(anchor, prefix, i, g) {
  const s = JSON.parse(JSON.stringify(anchor));
  const tk = prefix + String(i).padStart(3, '0');
  s.meta.ticker = tk;
  s.meta.name = anchor.meta.name + ' Filler ' + prefix + i;
  if (s.identifier) s.identifier.value = 'FILL:' + tk;
  const R = anchor.annual.annualRev[0].value;
  const gm = 0.45, opm = 0.12, nim = 0.10, fcfm = 0.15, ocfm = 0.18;
  const yr = [R, R / g, R / (g * g), R / (g * g * g)];
  const V = (arr) => arr.map((v) => ({ value: Math.round(v) }));
  s.annual.annualRev = V(yr);
  s.annual.annualGP = V(yr.map((v) => v * gm));
  s.annual.annualOpInc = V(yr.map((v) => v * opm));
  s.annual.annualNetIncome = V(yr.map((v) => v * nim));
  s.annual.annualFCF = V(yr.map((v) => v * fcfm));
  s.annual.annualOCF = V(yr.map((v) => v * ocfm));
  const qg = Math.pow(g, 0.25), Q0 = R / 4;
  const q = [0, 1, 2, 3, 4].map((k) => Q0 / Math.pow(qg, k));
  s.timeseries.revenueQ = V(q);
  s.timeseries.opIncQ = V(q.map((v) => v * opm));
  s.timeseries.grossProfitQ = V(q.map((v) => v * gm));
  s.timeseries.netIncomeQ = V(q.map((v) => v * nim));
  s.metrics.revenueTTM = { value: Math.round(q[0] + q[1] + q[2] + q[3]), source: 'x', confidence: 0.9 };
  s.metrics.revenueGrowthYoY = { value: (g - 1) * 100, source: 'x', confidence: 0.9 };
  return s;
}

const NSEMI = 60, NSOFT = 20, NIND = 20; // Anker + 100 Fueller >= 100; semi-Kohorte > topN
const gAt = (i, n) => 1.02 + 0.18 * (i / n);

/**
 * Schreibt das Universum nach `dir`.
 * @param {string}   dir
 * @param {object}   o
 * @param {string[]} o.weglassen  Anker-Ticker, die NICHT geschrieben werden (Datenschaden).
 * @param {number}   o.ueberholer Anzahl semiconductors-Fueller mit HOHEM Wachstum, die die
 *                                Halbleiter-Anker im Board nach unten druecken (Rangfolge-Riss).
 * @returns {{dateien:string[], geschrieben:string[]}}
 */
function schreibeUniversum(dir, o = {}) {
  const weglassen = new Set(o.weglassen || []);
  const ueberholer = o.ueberholer || 0;
  const ALAB = ladeFixture('ALAB'), PLTR = ladeFixture('PLTR'), BE = ladeFixture('BE'), CRDO = ladeFixture('CRDO');
  // NVDA hat keinen eingefrorenen Snapshot; der fuenfte Anker wird als Halbleiter-Klon von
  // ALAB gebaut (gleiche Route, eigener Name/Ticker) mit Wachstum ueber den Standard-Fuellern.
  const NVDA = fillerFrom(ALAB, 'NVDA', 0, 1.45);
  NVDA.meta.ticker = 'NVDA';
  NVDA.meta.name = 'Nvidia Testklon';
  if (NVDA.identifier) NVDA.identifier.value = 'FILL:NVDA';

  const geschrieben = [];
  const write = (s) => {
    if (weglassen.has(s.meta.ticker)) return;
    fs.writeFileSync(path.join(dir, s.meta.ticker + '.json'), JSON.stringify(s));
    geschrieben.push(s.meta.ticker);
  };
  for (const a of [CRDO, ALAB, PLTR, BE, NVDA]) write(a);
  for (let i = 1; i <= NSEMI; i++) write(fillerFrom(ALAB, 'ZSEMI', i, gAt(i, NSEMI)));
  for (let i = 1; i <= NSOFT; i++) write(fillerFrom(PLTR, 'ZSOFT', i, gAt(i, NSOFT)));
  for (let i = 1; i <= NIND; i++) write(fillerFrom(BE, 'ZIND', i, gAt(i, NIND)));
  // Ueberholer: extremes Wachstum -> ranken ueber allen Halbleiter-Ankern und schieben deren
  // Board-Prozentil ueber die Schwelle. Reiner Rangfolge-Effekt, die Zeilen bleiben heil.
  for (let i = 1; i <= ueberholer; i++) write(fillerFrom(ALAB, 'ZTOP', i, 6.0 + i * 0.05));

  return { dateien: fs.readdirSync(dir).filter((f) => f.endsWith('.json')), geschrieben };
}

module.exports = { fillerFrom, schreibeUniversum, ladeFixture, NSEMI, NSOFT, NIND, gAt };
