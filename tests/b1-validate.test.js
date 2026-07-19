'use strict';
// tests/b1-validate.test.js — synthetischer Beweis der B1-Engine VOR dem einen
// konfirmatorischen Lauf (Protokoll Tag 389 §4/§5/§8): First-Passage-Semantik,
// Matching-Caliper, Cluster-Bootstrap, Event-Flagging inkl. NoMargin-View.
const assert = require('assert');
const { firstPassage, buildPairs, clusterBootstrap } = require('../scripts/b1-validate.js');
const detect = require('../lib/b1-detect.js');

// Bars-Fabrik: startDatum + tägliche Multiplikatoren (Handelstage, ISO fortlaufend).
function mkBars(startIso, closes) {
  const d = new Date(startIso + 'T00:00:00Z');
  return closes.map((c) => {
    const iso = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: iso, close: c };
  });
}
// 100 Vor-Tage flach bei 100 mit Mini-Rauschen (σ_daily ≈ 0,01), dann Pfad.
function withHistory(path_) {
  const pre = [];
  for (let i = 0; i < 100; i++) pre.push(100 * (1 + 0.01 * ((i % 2) ? 1 : -1)));
  return pre.concat(path_);
}

// (1) First-Passage: Aufwärtspfad bricht obere Schranke -> upperFirst.
{
  const up = []; for (let i = 1; i <= 200; i++) up.push(100 * Math.pow(1.02, i)); // +2 %/Tag
  const bars = mkBars('2020-01-01', withHistory(up));
  const filed = bars[100].date; // Tag 0 = erster Pfad-Tag
  const r = firstPassage(bars, filed, {});
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.upperFirst, true, 'Aufwärtspfad muss oben zuerst treffen');
}
// (2) Absturzpfad -> untere Schranke zuerst.
{
  const dn = []; for (let i = 1; i <= 200; i++) dn.push(100 * Math.pow(0.98, i));
  const bars = mkBars('2020-01-01', withHistory(dn));
  const r = firstPassage(bars, bars[100].date, {});
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.upperFirst, false);
  assert.ok(r.lower, 'unten zuerst');
}
// (3) Flacher Pfad über 300 Tage -> Timeout = Miss (kein Drop).
{
  const flat = []; for (let i = 0; i < 300; i++) flat.push(100 + (i % 2 ? 0.5 : -0.5));
  const bars = mkBars('2020-01-01', withHistory(flat));
  const r = firstPassage(bars, bars[100].date, {});
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.upperFirst, false);
  assert.ok(r.timeout, 'Timeout zählt als Miss, wird nie gedroppt');
}
// (4) Serie endet im Fenster: primär unbrauchbar (Ausweis), Shumway-View = Miss.
{
  const short = []; for (let i = 0; i < 30; i++) short.push(100);
  const bars = mkBars('2020-01-01', withHistory(short));
  const prim = firstPassage(bars, bars[100].date, {});
  assert.strictEqual(prim.status, 'series_ended_in_window');
  const shum = firstPassage(bars, bars[100].date, { imputeMissing: true });
  assert.strictEqual(shum.status, 'ok');
  assert.strictEqual(shum.upperFirst, false, 'Imputation = nie oben zuerst');
}
// (5) Zu wenig Vor-Historie -> insufficient_history (Balance-Gate-Zählung).
{
  const bars = mkBars('2020-01-01', [100, 100, 100, 100, 100]);
  const r = firstPassage(bars, bars[2].date, {});
  assert.strictEqual(r.status, 'insufficient_history');
}

// (6) Matching: gleicher Sektor+Quartal matcht innerhalb Caliper; fremder Sektor nie;
//     dieselbe Kontrolle wird je Quartal nur 1x vergeben.
{
  const mkR = (cik, sic2, calQ, logMcap, mom, evsPctl) => ({ cik, sic2, calQ, filed: '2020-05-01', vars: { logMcap, mom, evsPctl }, bars: [] });
  const ev1 = mkR(1, '73', '2020Q2', 20, 0.1, 0.5);
  const ev2 = mkR(2, '73', '2020Q2', 20.1, 0.11, 0.52);
  const good = mkR(10, '73', '2020Q2', 20.05, 0.1, 0.5);
  const far = mkR(11, '73', '2020Q2', 27, 3.0, 0.99);
  const wrongSector = mkR(12, '28', '2020Q2', 20, 0.1, 0.5);
  const candByQ = new Map([['2020Q2', [good, far, wrongSector]]]);
  const { pairs, noMatch } = buildPairs([ev1, ev2], candByQ);
  assert.strictEqual(pairs.length, 1, 'good ist nach ev1 verbraucht; far liegt außerhalb des Calipers');
  assert.strictEqual(pairs[0].ctl.cik, 10);
  assert.strictEqual(noMatch, 1);
}

// (7) Cluster-Bootstrap: klarer positiver Effekt über 10 Cluster -> kleines p,
//     Null-Effekt -> großes p; nEff <= nClusters.
{
  const pos = [], nul = [];
  for (let c = 0; c < 10; c++) {
    for (let i = 0; i < 8; i++) {
      pos.push({ cluster: 'S|' + (2019 + c) + 'Q1', calQ: (2019 + c) + 'Q1', diff: (i < 6 ? 1 : 0) }); // Ø +0,75
      nul.push({ cluster: 'S|' + (2019 + c) + 'Q1', calQ: (2019 + c) + 'Q1', diff: (i % 2 ? 1 : -1) }); // Ø 0
    }
  }
  const bp = clusterBootstrap(pos, 2000, 42);
  assert.ok(bp.mean > 0.5 && bp.p < 0.01, 'starker Effekt muss kleines p liefern (p=' + bp.p + ')');
  assert.ok(bp.nEff <= bp.nClusters + 1e-9);
  const bn = clusterBootstrap(nul, 2000, 42);
  assert.ok(bn.p > 0.2, 'Null-Effekt darf nicht signifikant werden (p=' + bn.p + ')');
}

// (8) Event-Flagging: 250er-Kohorte, Top-Dezil + Konsekutiv + Margen-Bedingung;
//     isEventNoMargin ignoriert nur die Marge.
{
  const recs = [];
  for (let i = 0; i < 250; i++) {
    recs.push({
      cik: i, end: '2020-03-31', calQ: '2020Q1', filed: '2020-05-01',
      dYoY: i / 250, dYoYprev: 0.01, dOpMargin: (i % 2 ? 0.01 : -0.01), derivedInvolved: false,
    });
  }
  const cohorts = detect.flagEvents(recs);
  const ev = recs.filter((r) => r.isEvent), evNM = recs.filter((r) => r.isEventNoMargin);
  assert.ok(evNM.length >= 20 && evNM.length <= 30, 'Top-Dezil ~25 (' + evNM.length + ')');
  assert.ok(ev.length > 0 && ev.length < evNM.length, 'Margen-Bedingung halbiert (' + ev.length + ')');
  assert.ok(cohorts['2020Q1'].n === 250 && !cohorts['2020Q1'].belowMinN);
  // Mini-Kohorte (unter Mindest-N) erzeugt NIE Events:
  const small = recs.slice(0, 50).map((r) => ({ ...r, calQ: '2010Q1' }));
  detect.flagEvents(small);
  assert.ok(small.every((r) => !r.isEvent), 'Mindest-Kohorten-N-Gate');
}

console.log('b1-validate.test.js: alle 8 Blöcke grün');
