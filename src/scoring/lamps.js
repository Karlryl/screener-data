'use strict';
/**
 * Hypergrowth Engine — Schicht 3: Lampen (rank-and-warn)
 * ======================================================
 * Boolesche Warn-Flags, VOLLSTAENDIG getrennt vom Score. Eine Lampe senkt NIE
 * den Score (BE/PLTR ranken trotz Lampe oben) — sie (a) informiert das
 * Entry-Timing fuer den Elliott-Wellen-Chart-Check und (b) kann Track-Routing
 * ausloesen. Jede Lampe liest nur norm()-Serien + metrics. Rueckgabe je Lampe:
 * true (an) / false (aus) / null (nicht bewertbar).
 */

const { norm, hasPresent, firstPresent, firstTwoPresent, presentValues, metricVal, ratioSeries } = require('./snapshot.js');

// Schwellen (bewusst konservativ; Feinkalibrierung in der Formel-/Fixture-Phase)
const TH = {
  WACC_DEFAULT: 0.09,      // ROIC-Hurdle-Proxy
  HIGH_SBC_REV: 0.15,      // SBC/Rev-Niveau, ab dem Verwaesserung warnt
  AR_DIVERGENCE: 0.15,     // AR-Wachstum minus Umsatzwachstum (Channel-Stuffing)
  PEAK_MARGIN_MULT: 1.30,  // aktuelle Marge > 1.3x historischer Schnitt = Peak
  SHORT_RUNWAY_Q: 8,       // < 8 Quartale Cash-Runway = kurz
  HIGH_BETA: 2.5,          // Beta-Crash-Risiko
};

function meanPresent(series) {
  const vals = presentValues(series); // finite-only (faengt NaN/Infinity ab)
  return vals.length ? vals.reduce((p, c) => p + c, 0) / vals.length : null;
}

function _median(arr) {
  const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 1. Unprofitabel (reine Warnung, KEINE Score-Strafe) ------------------------
function unprofit(s) {
  const op = firstPresent(norm(s, 'annualOpInc'));
  const om = metricVal(s, 'operatingMargin');
  if (op === null && om === null) return null;
  if (op !== null) return op < 0;
  return om < 0;
}

// 2. Burning (juengstes FCF-Jahr negativ) ------------------------------------
function burning(s) {
  const f = firstPresent(norm(s, 'annualFCF'));
  if (f === null) return null;
  return f < 0;
}

// 3. Kurzer Cash-Runway (nur relevant wenn brennend) -------------------------
function shortRunway(s) {
  const f = firstPresent(norm(s, 'annualFCF'));
  if (f === null) return null;
  if (f >= 0) return false; // generiert Cash -> kein Runway-Risiko
  const cash = firstPresent(norm(s, 'annualBalance', 'totalCash'));
  if (cash === null) return null;
  const burnPerQuarter = Math.abs(f) / 4;
  if (burnPerQuarter === 0) return false;
  return (cash / burnPerQuarter) < TH.SHORT_RUNWAY_Q;
}

// 4. Hohe/steigende Verwaesserung (SBC/Rev) ----------------------------------
function highDilution(s) {
  const sbc = norm(s, 'annualSBC');
  if (!hasPresent(sbc)) return null;
  const r = ratioSeries(sbc, norm(s, 'annualRev')); // aligned SBC[i]/Rev[i], nicht unabh. firstPresent
  const lvl = firstPresent(r);
  if (lvl === null) return null;
  return lvl > TH.HIGH_SBC_REV;
}

// 5. Peak-Marge (zyklische Warnung) ------------------------------------------
function peakMargin(s) {
  // audit/fix (L1, Teil 1 — Basis-Mismatch): cur war die TTM-`operatingMargin`-Metrik, histRest aber
  // das Mittel ANNUALer opInc/rev-Ratios -> zwei verschiedene Basen verglichen (Samsung TTM 42.8% vs
  // annual 13.1% feuerte spurious; 806->631 Firings nach Fix). Jetzt cur = juengstes ANNUAL-Margin
  // (gleiche Basis wie histRest). peakMargin = "Marge historisch hoch" (breit, Mean-Reversion-Watch);
  // die schaerfere rolled-over-Variante ist cyclePeak (mit !rising-Guard).
  // COURT-ENTSCHEID (2026-06-28, L1 Teil 2, F22): KEIN !rising-Guard fuer peakMargin. Die Lampe bleibt
  // bewusst die BREITE Mean-Reversion-Watch und feuert per Design auf Margen-Expander (PLTR/MU). Der
  // guarded, recovery-aware Peak existiert separat als cyclePeak (Lampe 10, mit !rising). Ein Guard
  // hier wuerde peakMargin zum Near-Duplicate von cyclePeak kollabieren (543/549 Firings weg) und die
  // MU-Anker-Fixture brechen. Beide Lampen sind reine Timing-Warnungen (nicht in DATA_SUSPECT_LAMPS).
  // audit/fix (Court R3 Hygiene): margins erst KOMPAKTIEREN (presentValues), dann cur=m[0] /
  // histRest=mean(m.slice(1)) — wie cyclePeak/cycleDiscount. Vorher: cur=firstPresent (ueberspringt
  // fuehrende null-Luecken) vs histRest=positionalem slice(1) -> bei margins[0]===null wurde cur in
  // seine EIGENE Baseline gemittelt -> Lampe feuerte zu selten (8/46 Faelle, z.B. NEU/UVV). Reine
  // Display-Lampe (nicht in DATA_SUSPECT_LAMPS) -> kein Score/Exclude-Effekt; KEIN !rising-Guard
  // (Court F22: peakMargin bleibt die breite Mean-Reversion-Watch, NICHT cyclePeak-Duplikat).
  const m = presentValues(ratioSeries(norm(s, 'annualOpInc'), norm(s, 'annualRev')));
  const cur = m.length ? m[0] : null;
  const histRest = meanPresent(m.slice(1)); // ohne juengstes (kompaktiert, kein Eigen-Overlap)
  if (cur === null || histRest === null || histRest <= 0) return null;
  return cur > TH.PEAK_MARGIN_MULT * histRest;
}

// 6. ROIC < WACC-Proxy -------------------------------------------------------
function lowRoic(s) {
  // audit/fix (L2): wie capitalEfficiency (E1) — op (alle OpInc-Jahre) und inv (alle assets-Jahre)
  // mittelten ueber verschiedene Jahres-Sets. Jetzt pro Jahr zippen (OpInc present UND assets present).
  const opS = norm(s, 'annualOpInc');
  const assets = norm(s, 'annualBalance', 'totalAssets');
  const curLiab = norm(s, 'annualBalance', 'currentLiabilities');
  const opP = [], invP = [];
  const nYears = Math.max(opS.length, assets.length);
  for (let i = 0; i < nYears; i++) {
    const o = opS[i], a = assets[i];
    if (!Number.isFinite(o) || !Number.isFinite(a)) continue;
    const c = curLiab[i];
    opP.push(o); invP.push(a - (Number.isFinite(c) ? c : 0));
  }
  if (opP.length === 0) return null;
  const mean = (arr) => arr.reduce((p, c) => p + c, 0) / arr.length;
  const inv = mean(invP);
  if (inv <= 0) return null;
  return (mean(opP) / inv) < TH.WACC_DEFAULT;
}

// 7. AR-Divergenz (Forderungen wachsen schneller als Umsatz) -----------------
function arDivergence(s) {
  const ar = firstTwoPresent(norm(s, 'annualBalance', 'accountsReceivable'));
  const rev = firstTwoPresent(norm(s, 'annualRev'));
  if (!ar || !rev || ar[1] <= 0 || rev[1] <= 0) return null;
  const arG = ar[0] / ar[1] - 1;
  const revG = rev[0] / rev[1] - 1;
  return (arG - revG) > TH.AR_DIVERGENCE;
}

// 8. Crash-Risiko (hohe Volatilitaet) ----------------------------------------
function crashRisk(s) {
  const beta = metricVal(s, 'beta');
  if (beta === null) return null;
  return beta > TH.HIGH_BETA;
}

// 9. FCF-Artefakt: positive TTM-FCF-Marge, aber juengstes annualFCF-Jahr ist
// NEGATIV (echtes Vorzeichen-Artefakt wie NVTS +108%). Ein Turnaround mit
// positivem juengstem Jahr (BE/CRDO) ist KEIN Artefakt und wird NICHT geflaggt.
function fcfArtefact(s) {
  const ttm = metricVal(s, 'fcfMarginTTM');
  if (ttm === null || ttm <= 0) return false; // nur positive TTM koennen Artefakt sein
  const f0 = firstPresent(norm(s, 'annualFCF'));
  if (f0 === null) return null; // kein juengstes FCF-Jahr -> nicht bewertbar
  return f0 < 0; // TTM positiv, aber juengstes Jahr negativ = Artefakt
}

// 10. Zyklus-Peak (Court-Spec): schaerfere, Recovery-bewusste Peak-Warnung —
// flaggt NUR, wenn die aktuelle OpMarge weit ueber dem Eigen-Schnitt liegt UND
// nicht mehr steigt (echter Zyklus-Peak, kein struktureller Durchbruch). Damit
// werden Commodity-Peak-Price-Taker (Gold-Miner am Rekordpreis) markiert, ein
// echter Margen-Expandierer (cur>hist aber steigend) NICHT.
function cyclePeak(s) {
  const margins = ratioSeries(norm(s, 'annualOpInc'), norm(s, 'annualRev')); // aligned
  const m = presentValues(margins);
  if (m.length < 3) return null;
  const histRest = meanPresent(m.slice(1));
  if (histRest === null || histRest <= 0) return null;
  const rising = m[0] > m[1];
  return (m[0] > TH.PEAK_MARGIN_MULT * histRest) && !rising;
}

// --- 11+12: Daten-Qualitaets-Lampen (DISQUALIFIZIEREND) ----------------------
// Anders als die Lampen 1-10 (reine Timing-Warnungen, kein Score/Ranking-Effekt)
// excludiert der Orchestrator (score.js DATA_SUSPECT_LAMPS) einen Namen, der hier
// feuert, aus dem Ranking: sein Score baut auf ERFUNDENEN/GELEAKTEN Daten und darf NICHT
// #1 werden. Ports der battle-tested Loop-A-Detektoren (lib/newest-qtr-guard.js,
// lib/annual-currency-guard.js) — hier aus den Snapshot-Serien NEU gerechnet, weil die
// pre-A2-Snapshots die meta-Flags _newestQtrSuspect/_annualCurrencyLeakSuspect nicht tragen.

// 11. newest-quarter source-corruption (4-Leg, precision-first). Yahoo serviert sporadisch ein
// korruptes NEUESTES Quartal (Samsung 005930.KS opM 42.8% vs ~10% -> bogus revGrowthYoY). Vergleicht
// NUR das neueste Quartal gegen die EIGENEN trailing-Quartale (annual-frei). leg4 trennt Samsungs
// diskontinuierlichen Spike (q0/q1 ~2.0x) vom monotonen Aufschwung (MU ~1.5x).
function newestQtrSuspect(s) {
  const rev = norm(s, 'revenueQ'), oi = norm(s, 'opIncQ'), gp = norm(s, 'grossProfitQ');
  if (rev.length < 5) return null;                       // neuestes + >=4 trailing
  const r0 = rev[0], oi0 = oi[0], gp0 = gp[0], r1 = rev[1], oi1 = oi[1];
  if (!(r0 > 0) || !Number.isFinite(oi0) || !Number.isFinite(gp0)) return null;
  const q0opm = oi0 / r0, q0gm = gp0 / r0;
  const trailOpm = [], trailRev = [];
  for (let i = 1; i <= 4 && i < rev.length; i++) {
    const ri = rev[i], oii = oi[i];
    if (ri > 0) trailRev.push(ri);
    if (ri > 0 && Number.isFinite(oii)) trailOpm.push(oii / ri);
  }
  if (trailOpm.length < 3 || trailRev.length < 3) return null;
  const trailOpmMed = _median(trailOpm), trailRevMed = _median(trailRev);
  if (trailOpmMed === null || trailRevMed === null || !(trailRevMed > 0)) return null;
  const q1opm = (r1 > 0 && Number.isFinite(oi1)) ? oi1 / r1 : null;
  const REV_JUMP_MULT = 1.35;                            // Revenue-Sprung-Faktor, geteilt von leg3 + legRamp
  const leg1 = (q0opm - trailOpmMed) > 0.20;             // opM-Diskontinuitaet
  const leg2 = q0gm > 0.55;                              // physikalische GM-Schranke
  const leg3 = r0 > REV_JUMP_MULT * trailRevMed;         // Revenue-Sprung
  const leg4 = q1opm !== null && q1opm > 0.02 && q0opm >= 1.9 * q1opm; // Spike, kein Ramp
  // audit/fix (Court Phase A Runde 2, Fall 2): 5. Leg, NUR ENTSCHAERFEND (de-fire, nie zusaetzlich
  // excludierend). leg1-leg4 vergleichen q0 nur gegen die immediately-trailing 4 Quartale -> ein
  // SAISONALER Trog/Spike (VCEL Q4: q0opm 24.1% vs trailMed 1.0%) sieht dort anomal aus, obwohl q0
  // dem VORJAHRES-gleichen Quartal (Index 4) gleicht. Gleicht q0-OpMarge der year-ago-OpMarge
  // (kleine YoY-Diskontinuitaet, TH 0.20 aus leg1 wiederverwendet) -> Saisonalitaet, kein korruptes
  // Quartal -> de-fire. SNDK (70.0% vs -2.5% YoY, |d|=0.73) und Samsung (42.8% vs 8.4%, |d|=0.34)
  // bleiben YoY-anomal -> feuern weiter (keine pauschale Exoneration).
  const r4 = rev[4], oi4 = oi[4];
  const q4opm = (r4 > 0 && Number.isFinite(oi4)) ? oi4 / r4 : null;
  const legSeasonal = q4opm !== null && Math.abs(q0opm - q4opm) <= 0.20;
  // audit/fix (Court Phase A Runde 6): 6. Leg legRamp, NUR ENTSCHAERFEND. Eine echte monotone Frueh-
  // Kommerzialisierungs-Rampe (LQDA revQ 3M->133M in 5 Q) triggert leg4 faelschlich (q0opm>=1.9*q1opm),
  // ist aber KEINE Yahoo-Fabrikation. legRamp de-firet, wenn ALLE 4 trailing QoQ-Umsatz-Schritte den
  // Revenue-Sprung-Faktor uebersteigen (durchgehende explosive Rampe) — die bestehende REV_JUMP_MULT-
  // Schwelle wiederverwendet (KEINE neue Konstante). Ein isolierter Einzel-Q-Margen-Spike (das
  // Fabrikations-Muster: Samsung/SNDK/ONEX brechen bereits an QoQ-Schritt 2) kann diese mehr-quartalige
  // Rampen-FORM strukturell nicht faken -> precision-safe. Jede Luecke/nichtpositiver Umsatz -> false.
  let legRamp = true;
  for (let i = 0; i < 4; i++) {
    const a = rev[i], b = rev[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > 0) || !(a > REV_JUMP_MULT * b)) { legRamp = false; break; }
  }
  return !!(leg1 && leg2 && leg3 && leg4 && !legSeasonal && !legRamp);
}

// 12. annual-revenue currency-leak (3-Leg). USD-Reporter, dessen annualRev in der TRADING-ccy landet
// (NOK ~10x: AKRBP.OL/GMAB.CO) -> annual-Metriken untrustworthy. Die Quartals-Seite muss GESUND sein
// (isoliert das annual-Array als das geleakte, vs. ein separat kaputtes Quartals-TTM).
function annualCurrencyLeak(s) {
  const meta = s && s.meta;
  if (!meta) return null;
  const repOrig = meta.reportingCurrencyOriginal, trade = meta.tradingCurrency;
  if (!repOrig || !trade) return null;                   // ccy-Felder fehlen -> nicht bewertbar
  if (repOrig === trade) return false;                   // keine ccy-Divergenz -> kein Leak moeglich
  const a0 = norm(s, 'annualRev')[0];                    // neuestes annual (positional)
  if (!(a0 > 0)) return null;
  const revQ = norm(s, 'revenueQ');
  const q = [];
  for (let i = 0; i < 4; i++) { if (Number.isFinite(revQ[i])) q.push(revQ[i]); }
  if (q.length < 4) return null;                         // volles 4-Q-TTM noetig
  const qTTM = q[0] + q[1] + q[2] + q[3];
  if (!(qTTM > 0)) return null;
  const ratio = a0 / qTTM;
  if (!(ratio > 3)) return false;                        // annual nicht inflationiert -> kein Leak
  const revTTM = metricVal(s, 'revenueTTM');
  if (revTTM === null) return null;
  const ttmRatio = revTTM / qTTM;
  if (ttmRatio < 0.6 || ttmRatio > 1.6) return false;    // Quartals-TTM kaputt -> anderes Defekt
  return true;
}

// 13. Burn-Beschleunigung (Council/Court, Karl-Direktive): Firma verbrennt Cash UND vertieft den
// operativen Verlust ggue. dem Vorjahres-GJ -> die Einheiten-Oekonomie VERSCHLECHTERT sich, trotz evtl.
// starkem Rueckblick-Wachstum (IONQ: Umsatz +755%, aber FCF -57M->-300M). Vorzeichen-Gate + YoY-Schritt,
// data-learned (keine Magic Number). Turnaround-zu-positiv (CRDO/ALAB/BE: neuestes FCF & OpInc >=0) faellt
// STRUKTURELL aus dem Gate. REIN WARNEND (nicht in DATA_SUSPECT_LAMPS) — druckt den Score NICHT (der
// Score-Abzug fuer Verschlechterer ist als naechste Iteration deferred, muss veto-sicher gebaut werden).
function burnAccelerating(s) {
  const fcf = presentValues(norm(s, 'annualFCF'));
  const opi = presentValues(norm(s, 'annualOpInc'));
  if (fcf.length < 2 || opi.length < 2) return null;
  if (!(fcf[0] < 0) || !(opi[0] < 0)) return false;   // Gate: noch am Verbrennen UND operativ unprofitabel
  return fcf[0] < fcf[1] && opi[0] < opi[1];           // beide tiefer als Vorjahr -> Burn/Verlust beschleunigt
}

const LAMPS = {
  unprofit, burning, shortRunway, highDilution, peakMargin,
  lowRoic, arDivergence, crashRisk, fcfArtefact, cyclePeak,
  burnAccelerating,
  newestQtrSuspect, annualCurrencyLeak,
};

/**
 * evaluateLamps(s) -> { flags: {name:bool|null}, active: [names mit true] }
 * Reine Anzeige — fliesst NIE in den Score ein.
 */
function evaluateLamps(s) {
  const flags = {};
  const active = [];
  for (const [name, fn] of Object.entries(LAMPS)) {
    const v = fn(s);
    flags[name] = v;
    if (v === true) active.push(name);
  }
  return { flags, active };
}

module.exports = { evaluateLamps, LAMPS, TH, ...LAMPS };
