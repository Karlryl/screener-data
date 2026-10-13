#!/usr/bin/env node
'use strict';
/**
 * WEGWERF-MESSSKRIPT — Karls Auflage 1 (T130), 5.2 Small-Cap-Board, 2026-08-29.
 * ============================================================================
 * Nur Lesen. Schreibt AUSSCHLIESSLICH eine JSON-Messdatei in den Scratchpad
 * (Pfad via argv[2]), nichts im Repo.
 *
 * Drei Mess-Ebenen (bewusst getrennt, damit "Store falsch" von "Code falsch"
 * unterscheidbar bleibt):
 *   A  PROD   — Achsen-Rohwert wie die Engine ihn rechnet (score.rawAxisValue,
 *               mit den EINGEFRORENEN Lineal-Schranken aus outputs/smallcap/calibration.json).
 *   B  EIGEN  — dieselbe Achse, nochmal von Hand aus den Store-Reihen gerechnet
 *               (eigene Arithmetik in diesem File, kein Aufruf von axes.js).
 *   C  SEC    — dieselbe Achse aus der SEC-XBRL-Jahresschicht (echte 10-K/20-F/40-F).
 *   D  ROH    — nur HNRG: direkt aus den companyfacts (external-data/sec-xbrl/<cik>.json),
 *               inkl. selbst gebauter Quartalsreihe (3-Monats-Frames) und GP=Rev-COGS.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node _tmp-auflage1-messung.js <out.json>'); process.exit(2); }

const { loadSmallcapUniverse } = require(path.join(ROOT, 'src/scoring/run-screener.js'));
const { rawAxisValue } = require(path.join(ROOT, 'src/scoring/score.js'));
const axesFns = require(path.join(ROOT, 'src/scoring/axes.js'));
const smallcapFormulas = require(path.join(ROOT, 'src/scoring/formulas/smallcap/index.js'));

const AXES7 = ['revGrowthLevel', 'revAcceleration', 'gpGrowth', 'ruleOfX', 'marginTrajectory', 'capitalEfficiency', 'dilution'];

// ---------------------------------------------------------------- 0. Auswahlregel
// VOR jedem Blick auf ein Ergebnis fixiert (siehe Report §1):
//  P  = alle Zeilen der 11 aktuellen Small-Cap-Boards (outputs/smallcap/smallcap-*.json)
//  E  = davon jene mit Eintrag in external-data/sec-secannual-smallcap.json (Grundwahrheit vorhanden)
//  S  = je Board (Sektor x Track) der bestplatzierte UND der schlechtestplatzierte
//       eligible Name (identisch, wenn nur einer eligible ist). Rang, nicht Score.
function auswahl() {
  const dir = path.join(ROOT, 'outputs', 'smallcap');
  const sec = JSON.parse(fs.readFileSync(path.join(ROOT, 'external-data', 'sec-secannual-smallcap.json'), 'utf8'));
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('smallcap-') && f.endsWith('.json'));
  const alle = [], gewaehlt = [];
  for (const f of files.sort()) {
    const board = f.replace(/\.json$/, '');
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const track of ['profitable', 'unprofitable']) {
      const list = j[track] || [];
      list.forEach((e, i) => alle.push({ board, track, rank: i + 1, n: list.length, ticker: e.ticker, score: e.score, row: e }));
      const eligible = list.map((e, i) => ({ board, track, rank: i + 1, n: list.length, ticker: e.ticker, score: e.score, row: e }))
        .filter((r) => !!sec[r.ticker]);
      if (!eligible.length) continue;
      const pick = [eligible[0]];
      if (eligible.length > 1) pick.push(eligible[eligible.length - 1]);
      for (const p of pick) gewaehlt.push({ ...p, pos: p === eligible[0] ? 'bester-eligible' : 'schlechtester-eligible' });
    }
  }
  return { alle, gewaehlt, sec };
}

// ---------------------------------------------------------------- Helfer (eigene Arithmetik)
const unwrap = (arr) => (Array.isArray(arr) ? arr.map((e) => {
  const v = (e && typeof e === 'object') ? e.value : e;
  return Number.isFinite(v) ? v : null;
}) : []);
const bal = (s, key) => (Array.isArray(s.annual && s.annual.annualBalance)
  ? s.annual.annualBalance.map((e) => (e && Number.isFinite(e[key]) ? e[key] : null)) : []);
const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
const clamp = (v, b) => (b ? Math.max(b[0], Math.min(b[1], v)) : v);
const ratio = (a, b) => a.map((v, i) => {
  const d = b[i];
  return (v === null || d === null || d === undefined || !(Math.abs(d) > 0)) ? null : v / d;
});
const lastPresent = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && a[i] !== undefined) return a[i]; return null; };

// --- Achsen, EIGENE Implementierung (Spezifikation aus den axes.js-Kommentaren, nicht der Code) ---
function eigenRevAnnualYoY(rev) {
  if (!(rev.length >= 2) || rev[0] === null || rev[1] === null || !(rev[1] > 0)) return null;
  return rev[0] / rev[1] - 1;
}
function eigenRevAccelAnnual(rev, bounds) {
  const ar = rev.filter((v) => v !== null && v > 0);
  if (ar.length < 3) return null;
  return clamp(ar[0] / ar[1] - 1, bounds) - clamp(ar[1] / ar[2] - 1, bounds);
}
function eigenGpGrowth(gp, rev) {
  if (gp[0] === null || gp[1] === null || !(gp[1] > 0)) return null;
  const gpYoY = gp[0] / gp[1] - 1;
  const gm = ratio(gp, rev).map((v) => (v !== null && v >= 0 && v <= 1 ? v : null));
  const gmNew = gm[0], gmOld = lastPresent(gm);
  return gpYoY + ((gmNew !== null && gmOld !== null) ? gmNew - gmOld : 0);
}
function eigenDilution(sbc, rev) {
  if (!sbc.some((v) => v !== null)) return null;
  const raw = ratio(sbc, rev);
  if (raw[0] === null || raw[0] === undefined) return null;
  const level = Math.min(1, Math.max(0, raw[0]));
  const oldRaw = lastPresent(raw);
  const slope = (oldRaw !== null && oldRaw >= 0 && oldRaw <= 1) ? level - oldRaw : 0;
  return -level - slope;
}
function eigenMarginTrajectory(oiQ, revQ, bounds) {
  if (!(revQ[0] > 0) || oiQ[0] === null || oiQ[0] === undefined) return null;
  const m = [];
  const n = Math.max(oiQ.length, revQ.length);
  for (let i = 0; i < n; i++) {
    const r = revQ[i], o = oiQ[i];
    if (!(r > 0) || o === null || o === undefined) continue;
    m.push(clamp(o / r, bounds));
  }
  if (m.length < 2) return null;
  return m[0] - m[m.length - 1];
}
// capitalEfficiency, komplett eigenhaendig (ROIC-Trim + Zyklus-Discount + Asset-Penalty)
function eigenCapEff(opInc, assets, curLiab, revYahoo, opIncYahoo) {
  const op = [], inv = [];
  const n = Math.max(opInc.length, assets.length);
  for (let i = 0; i < n; i++) {
    const o = opInc[i], a = assets[i], c = curLiab[i];
    if (o === null || o === undefined || a === null || a === undefined || c === null || c === undefined) continue;
    const v = a - c;
    if (!(v > 0)) continue;
    op.push(o); inv.push(v);
  }
  if (!op.length) return null;
  let end = op.length;
  if (op[0] > 0) while (end > 1 && op[end - 1] <= 0) end--;
  const roic = mean(op.slice(0, end)) / mean(inv.slice(0, end));
  let penalty = 0;
  if (assets.length >= 2 && assets[0] !== null && assets[1] !== null && assets[1] > 0
    && revYahoo.length >= 2 && revYahoo[0] !== null && revYahoo[1] !== null && revYahoo[1] > 0) {
    penalty = Math.max(0, (assets[0] / assets[1] - 1) - (revYahoo[0] / revYahoo[1] - 1));
  }
  const mRaw = ratio(opIncYahoo, revYahoo);
  const m = mRaw.filter((v) => v !== null);
  let disc = 1;
  if (mRaw[0] !== null && m.length >= 3) {
    const cur = m[0], prev = m[1], hist = mean(m.slice(1));
    if (hist > 0 && cur > hist) {
      const over = cur / hist - 1;
      const rawDisc = 1 / (1 + Math.max(0, over));
      const climb = (cur - hist) > 0 ? (cur - prev) / (cur - hist) : 0;
      const blend = Math.max(0, Math.min(1, climb));
      disc = 1 - (1 - rawDisc) * (1 - blend);
    }
  }
  return roic * disc - penalty;
}

// ---------------------------------------------------------------- D. Roh-companyfacts (HNRG)
const ANNUAL_FORMS = ['10-K', '20-F', '40-F'];
const REV_PRIO = ['RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet'];
function fyMap(g, concept) {
  const out = new Map();
  const u = (g[concept] && g[concept].units && g[concept].units.USD) || [];
  for (const x of u) {
    if (!ANNUAL_FORMS.includes(x.form) || x.fp !== 'FY' || x.fy == null || !Number.isFinite(x.val)) continue;
    const prev = out.get(x.fy);
    if (!prev || x.end > prev.end || (x.end === prev.end && (x.filed || '') > (prev.filed || ''))) {
      out.set(x.fy, { val: x.val, end: x.end, accn: x.accn, filed: x.filed || null });
    }
  }
  return out;
}
function fyRevMap(g) {
  const out = new Map();
  for (const c of REV_PRIO) for (const [fy, e] of fyMap(g, c)) if (!out.has(fy)) out.set(fy, { ...e, concept: c });
  return out;
}
// 3-Monats-Quartale: alle Frames mit 80..100 Tagen Laufzeit, dedupe je end (spaeteste Einreichung gewinnt).
function qSeries(g, concept) {
  const u = (g[concept] && g[concept].units && g[concept].units.USD) || [];
  const byEnd = new Map();
  for (const x of u) {
    if (!x.start || !x.end || !Number.isFinite(x.val)) continue;
    const d = (Date.parse(x.end) - Date.parse(x.start)) / 86400000;
    if (!(d >= 80 && d <= 100)) continue;
    const prev = byEnd.get(x.end);
    if (!prev || (x.filed || '') > (prev.filed || '')) byEnd.set(x.end, { val: x.val, end: x.end, accn: x.accn, filed: x.filed || null });
  }
  return [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1));
}
// Umsatz-Quartale als UNION ueber die Prio-Konzepte je end-Datum (ein Filer wechselt das
// Konzept ueber die Jahre — wer nur EIN Konzept nimmt, bekommt eine stale Reihe).
function qSeriesRev(g) {
  const byEnd = new Map(), conc = new Map();
  for (const c of REV_PRIO) for (const x of qSeries(g, c)) if (!byEnd.has(x.end)) { byEnd.set(x.end, x); conc.set(x.end, c); }
  const serie = [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1));
  return { serie, concept: serie.length ? conc.get(serie[0].end) : null };
}
// Q4 fehlt bei vielen Filern als 3-Monats-Frame (nur im 10-K als Volljahr). Aus dem
// Jahreswert minus der drei vorhandenen Quartale desselben GJ rekonstruieren.
function q4Aus10K(qEnds, qVals, fyEnde, fyWert) {
  if (!Number.isFinite(fyWert) || !fyEnde) return null;
  const jahr = fyEnde.slice(0, 4);
  let summe = 0, n = 0;
  for (let i = 0; i < qEnds.length; i++) {
    if (qEnds[i].slice(0, 4) !== jahr || qEnds[i] === fyEnde) continue;
    if (!Number.isFinite(qVals[i])) continue;
    summe += qVals[i]; n++;
  }
  return n === 3 ? fyWert - summe : null;
}

// ---------------------------------------------------------------- Lauf
function run() {
  const { alle, gewaehlt, sec } = auswahl();
  const calib = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'smallcap', 'calibration.json'), 'utf8'));
  const winsorBounds = calib.winsorBounds, growthBounds = calib.growthBounds;

  const universe = loadSmallcapUniverse(); // enthaelt filterToAuthorizedUniverse + mergeSecIntoUniverse
  const byTicker = new Map(universe.map((s) => [s.meta.ticker, s]));

  const namen = [];
  for (const g of gewaehlt) {
    const s = byTicker.get(g.ticker);
    if (!s) { namen.push({ ...g, row: undefined, fehler: 'kein Snapshot im gerouteten Universum' }); continue; }
    const formulaId = 'smallcap-' + g.board.replace(/^smallcap-/, '');
    const formula = smallcapFormulas[formulaId];
    if (!formula) { namen.push({ ...g, row: undefined, fehler: 'keine Formel ' + formulaId }); continue; }

    // ---- Store-Reihen
    const revY = unwrap(s.annual.annualRev), gpY = unwrap(s.annual.annualGP), oiY = unwrap(s.annual.annualOpInc);
    const sbcY = unwrap(s.annual.annualSBC), assY = bal(s, 'totalAssets'), clY = bal(s, 'currentLiabilities');
    const revQ = unwrap(s.timeseries && s.timeseries.revenueQ), oiQ = unwrap(s.timeseries && s.timeseries.opIncQ);
    // ---- SEC-Reihen (aus dem Snapshot, so wie die Engine sie sieht)
    const d = sec[g.ticker] || {};
    const revS = unwrap(d.annualRev), oiS = unwrap(d.annualOpInc), assS = unwrap(d.annualAssets), clS = unwrap(d.annualCurrentLiabilities);
    const src = axesFns.roicStabilitySource(s)._source;

    // ---- A: PROD
    const prod = {};
    for (const k of AXES7) prod[k] = rawAxisValue(s, k, formula, g.track, winsorBounds, growthBounds);

    // ---- B: EIGEN (aus Store-Reihen, eigene Arithmetik)
    const quartalsYoY = axesFns.revQuartalsYoY(s); // WELCHER Zweig zieht (Diagnose, kein Wert)
    const eigenRevLvlAnnual = eigenRevAnnualYoY(revY);
    const eigen = {
      revGrowthLevel: (quartalsYoY !== null ? quartalsYoY : eigenRevLvlAnnual),
      revAcceleration: eigenRevAccelAnnual(revY, winsorBounds && winsorBounds.qoq),
      gpGrowth: eigenGpGrowth(gpY, revY),
      ruleOfX: null,
      marginTrajectory: eigenMarginTrajectory(oiQ, revQ, winsorBounds && winsorBounds.opMargin),
      capitalEfficiency: eigenCapEff(
        src === 'sec' ? oiS : oiY, src === 'sec' ? assS : assY, src === 'sec' ? clS : clY, revY, oiY),
      dilution: eigenDilution(sbcY, revY),
    };
    if (eigen.revGrowthLevel !== null) {
      eigen.revGrowthLevel = clamp(eigen.revGrowthLevel, growthBounds) * 100;
      // metrics.* sind {value,source,asOf}-Objekte (snapshot.js metricVal), nicht nackte Zahlen.
      const mv = s.metrics && s.metrics.fcfMarginTTM ? s.metrics.fcfMarginTTM.value : undefined;
      const fcfM = Number.isFinite(mv) ? mv : null;
      const { fcfTrack } = require(path.join(ROOT, 'src/scoring/engine.js'));
      const inc = fcfTrack(fcfM, unwrap(s.annual.annualFCF), unwrap(s.annual.annualOCF)) === 'profitable';
      const { fcfMarginValid } = require(path.join(ROOT, 'src/scoring/engine.js'));
      let x = formula.alpha * eigen.revGrowthLevel;
      if (inc && fcfMarginValid(fcfM, unwrap(s.annual.annualFCF), unwrap(s.annual.annualOCF))) x += fcfM;
      eigen.ruleOfX = x;
    }

    // ---- C: SEC (echte Filings)
    const secAx = {
      revGrowthLevel: (() => { const v = eigenRevAnnualYoY(revS); return v === null ? null : clamp(v, growthBounds) * 100; })(),
      revAcceleration: eigenRevAccelAnnual(revS, winsorBounds && winsorBounds.qoq),
      gpGrowth: null,           // SEC-Jahresschicht fuehrt kein GrossProfit
      ruleOfX: null,            // wird unten aus secAx.revGrowthLevel gebildet
      marginTrajectory: null,   // SEC-Jahresschicht fuehrt keine Quartale
      capitalEfficiency: eigenCapEff(oiS, assS, clS, revS, oiS),
      dilution: null,           // SEC-Jahresschicht fuehrt kein ShareBasedCompensation
    };
    if (secAx.revGrowthLevel !== null) secAx.ruleOfX = formula.alpha * secAx.revGrowthLevel;

    namen.push({
      board: g.board, track: g.track, rank: g.rank, n: g.n, pos: g.pos, ticker: g.ticker,
      score: g.score, lamps: g.row.lamps, coverageAxes: g.row.coverageAxes, cohortN: g.row.cohortN,
      formulaId, alpha: formula.alpha, roicSource: src, nfy: d.nfy || null, secTiefe: revS.length,
      quartalsZweig: quartalsYoY !== null,
      inputs: {
        store: { annualRev: revY, annualGP: gpY, annualOpInc: oiY, annualSBC: sbcY, totalAssets: assY, currentLiabilities: clY, revenueQ: revQ, opIncQ: oiQ, revenueQEnds: (s.timeseries && s.timeseries.revenueQEnds) || null, fcfMarginTTM: (s.metrics && s.metrics.fcfMarginTTM) ? s.metrics.fcfMarginTTM.value : null, metricsAsOf: (s.metrics && s.metrics.fcfMarginTTM) ? s.metrics.fcfMarginTTM.asOf : null },
        sec: { annualRev: revS, annualOpInc: oiS, annualAssets: assS, annualCurrentLiabilities: clS, annualShares: unwrap(d.annualShares), annualFCF: unwrap(d.annualFCF) },
      },
      prod, eigen, sec: secAx,
      boardRevGrowthYoYPct: g.row.revGrowthYoYPct,
      axisBreakdown: g.row.axisBreakdown,
    });
  }

  // ---- D: HNRG-Tiefenanker aus den Roh-companyfacts
  let hnrg = null;
  try {
    const cf = JSON.parse(fs.readFileSync(path.join(ROOT, 'external-data', 'sec-xbrl', '0000788965.json'), 'utf8'));
    const g = cf.facts['us-gaap'];
    const rev = fyRevMap(g), oi = fyMap(g, 'OperatingIncomeLoss'), cogs = fyMap(g, 'CostOfGoodsAndServicesSold');
    const sbc = fyMap(g, 'ShareBasedCompensation'), ass = fyMap(g, 'Assets'), cl = fyMap(g, 'LiabilitiesCurrent');
    const fys = [...rev.keys()].sort((a, b) => b - a).filter((y) => y >= 2015);
    const pick = (m) => fys.map((y) => (m.has(y) ? m.get(y).val : null));
    const revA = pick(rev), oiA = pick(oi), cogsA = pick(cogs), sbcA = pick(sbc), assA = pick(ass), clA = pick(cl);
    const gpA = revA.map((v, i) => (v !== null && cogsA[i] !== null ? v - cogsA[i] : null));
    const qr = qSeriesRev(g), qo = qSeries(g, 'OperatingIncomeLoss');
    let qEnds = qr.serie.map((x) => x.end);
    let qRevV = qr.serie.map((x) => x.val);
    let qOiV = qEnds.map((e) => { const h = qo.find((x) => x.end === e); return h ? h.val : null; });
    // fehlendes Q4 (2025-12-31) aus dem 10-K rekonstruieren und einsortieren
    const fyEnde2025 = '2025-12-31';
    if (!qEnds.includes(fyEnde2025)) {
      const r4 = q4Aus10K(qEnds, qRevV, fyEnde2025, revA[fys.indexOf(2025)]);
      const o4 = q4Aus10K(qEnds, qOiV, fyEnde2025, oiA[fys.indexOf(2025)]);
      if (r4 !== null) {
        const pos = qEnds.findIndex((e) => e < fyEnde2025);
        const at = pos === -1 ? qEnds.length : pos;
        qEnds = [...qEnds.slice(0, at), fyEnde2025, ...qEnds.slice(at)];
        qRevV = [...qRevV.slice(0, at), r4, ...qRevV.slice(at)];
        qOiV = [...qOiV.slice(0, at), o4, ...qOiV.slice(at)];
      }
    }
    const s = byTicker.get('HNRG');
    // Fenster-gleiche Jahresreihen (Store fuehrt 4 GJ) fuer die Achsen, die "aeltestes Jahr" lesen
    const tiefeStore = unwrap(s.annual.annualRev).length;
    const revW = revA.slice(0, tiefeStore), gpW = gpA.slice(0, tiefeStore), sbcW = sbcA.slice(0, tiefeStore);
    const rohAx = {
      // revGrowthLevel: gleicher Zweig wie die Engine — juengstes Quartal gegen das Vorjahresquartal
      // (per Enddatum), damit Definition und Periode identisch sind.
      revGrowthLevel: (() => {
        const idx = qEnds.findIndex((e, i) => i > 0 && Math.abs((Date.parse(qEnds[0]) - Date.parse(e)) / 86400000 - 365) <= 45);
        if (idx > 0 && qRevV[0] > 0 && qRevV[idx] > 0) return clamp(qRevV[0] / qRevV[idx] - 1, growthBounds) * 100;
        const v = eigenRevAnnualYoY(revW); return v === null ? null : clamp(v, growthBounds) * 100;
      })(),
      // revAcceleration: die Engine faellt bei 5 Quartalen auf die JAHRESreihe zurueck -> derselbe
      // Zweig hier (gleiche Definition). Der tiefe 10-Q-Zweig steht daneben als rohAxQuartal.
      revAcceleration: eigenRevAccelAnnual(revW, winsorBounds && winsorBounds.qoq),
      gpGrowth: eigenGpGrowth(gpW, revW),
      marginTrajectory: (() => {
        const nQ = unwrap(s.timeseries.revenueQ).length;
        return eigenMarginTrajectory(qOiV.slice(0, nQ), qRevV.slice(0, nQ), winsorBounds && winsorBounds.opMargin);
      })(),
      capitalEfficiency: eigenCapEff(oiA, assA, clA, revA, oiA),
      dilution: eigenDilution(sbcW, revW),
    };
    // Zusatz: echte QUARTALS-Beschleunigung aus der tiefen 10-Q-Historie (Datenquellen-Grenze der Engine)
    const yoyTief = [];
    for (let i = 0; i < qRevV.length; i++) {
      const idx = qEnds.findIndex((e, k) => k > i && Math.abs((Date.parse(qEnds[i]) - Date.parse(e)) / 86400000 - 365) <= 45);
      if (idx > 0 && qRevV[i] > 0 && qRevV[idx] > 0) yoyTief.push(clamp(qRevV[i] / qRevV[idx] - 1, winsorBounds && winsorBounds.qoq));
    }
    rohAx._revAccelQuartalTief = yoyTief.length >= 2 ? yoyTief[0] - yoyTief[yoyTief.length - 1] : null;
    rohAx._nYoYPaareTief = yoyTief.length;
    // ruleOfX: alpha * revGrowthLevel (+FCF-Term nur bei gueltigem TTM — der ist nicht aus SEC-Jahren bildbar)
    const fUtil = smallcapFormulas['smallcap-utilities'];
    rohAx.ruleOfX = rohAx.revGrowthLevel === null ? null : fUtil.alpha * rohAx.revGrowthLevel;
    hnrg = {
      fys, revA, oiA, cogsA, gpA, sbcA, assA, clA,
      revConceptFY: fys.map((y) => (rev.has(y) ? rev.get(y).concept : null)),
      accnFY: fys.map((y) => (rev.has(y) ? rev.get(y).accn : null)),
      endFY: fys.map((y) => (rev.has(y) ? rev.get(y).end : null)),
      qEnds, qRevV, qOiV, qConcept: qr.concept,
      rohAx,
      storeQ: { revenueQ: unwrap(s.timeseries.revenueQ), opIncQ: unwrap(s.timeseries.opIncQ), ends: s.timeseries.revenueQEnds },
      storeA: { annualRev: unwrap(s.annual.annualRev), annualGP: unwrap(s.annual.annualGP), annualOpInc: unwrap(s.annual.annualOpInc), annualSBC: unwrap(s.annual.annualSBC), totalAssets: bal(s, 'totalAssets'), currentLiabilities: bal(s, 'currentLiabilities') },
    };
  } catch (e) { hnrg = { fehler: e.message }; }

  const res = {
    stand: new Date().toISOString(),
    kalibrierung: { datei: 'outputs/smallcap/calibration.json', generated_at: calib.generated_at, winsorBounds, growthBounds },
    population: alle.length,
    eligible: alle.filter((r) => !!sec[r.ticker]).length,
    stichprobe: namen.length,
    namen, hnrg,
  };
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  console.log(`\n>>> ${namen.length} Namen gemessen, Population ${alle.length}, eligible ${res.eligible} -> ${OUT}`);
  for (const n of namen) {
    console.log(`${n.ticker.padEnd(6)} ${n.board.replace('smallcap-', '').padEnd(24)} ${n.track.padEnd(13)} r${n.rank}/${n.n} src=${n.roicSource} qZweig=${n.quartalsZweig} secTiefe=${n.secTiefe}`);
  }
}
run();
