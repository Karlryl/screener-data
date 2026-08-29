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

const { norm, hasPresent, firstPresent, firstTwoPresent, presentValues, metricVal, ratioSeries,
  jahresVergleichIdx, jahresFensterAusgerichtet, histOpInc, opIncSynthetic } = require('./snapshot.js');
// U-SC-003: die ROIC-Quellenwahl der ACHSEN (SEC-Trio wo vollstaendig, sonst Yahoo) — lowRoic liest
// sie, statt eine zweite Yahoo-Kopie zu pflegen. axes.js kennt lamps.js nicht -> kein Zyklus.
const { roicStabilitySource } = require('./axes.js');

// Schwellen (bewusst konservativ; Feinkalibrierung in der Formel-/Fixture-Phase)
const TH = {
  WACC_DEFAULT: 0.09,      // ROIC-Hurdle-Proxy
  HIGH_SBC_REV: 0.15,      // SBC/Rev-Niveau, ab dem Verwaesserung warnt
  AR_DIVERGENCE: 0.15,     // AR-Wachstum minus Umsatzwachstum (Channel-Stuffing)
  PEAK_MARGIN_MULT: 1.30,  // aktuelle Marge > 1.3x historischer Schnitt = Peak
  SHORT_RUNWAY_Q: 8,       // < 8 Quartale Cash-Runway = kurz
  HIGH_BETA: 2.5,          // Beta-Crash-Risiko
  SHARES_ORGANIC_CAP: 2,   // s. shareYoYLegs()
  SHARE_DILUTION_PCTL: 0.75, // s. shareCountDilution() — reuse der etablierten p75-Konvention (wie CYCLE_DD_PCTL, score.js)
  // SBC-Run-Rate-Anker analog SHARES_ORGANIC_CAP; Rat 04.08. (Stufe A, _RAT-52-VERWAESSERUNG-
  // 2026-08-04.md): reines Kohorten-Perzentil feuert auch fuer eine Firma, deren Aktienzahl real
  // SCHRUMPFT — pctl misst nur den Rang, nicht das Vorzeichen/die Groesse der Rate (MGPI-Klasse:
  // negative Rate, aber schwaechste Kohorte -> trotzdem p75+). 2 % p.a. ist die Reichweiten-
  // Untergrenze, ab der ueberhaupt von Verwaesserung die Rede sein kann — die Lampe feuert ab
  // jetzt als KONJUNKTION (pctl >= SHARE_DILUTION_PCTL UND rate >= SHARE_DILUTION_MIN_RATE),
  // shareDilutionDetail (die rohen Rate/Perzentil-Zahlen) bleibt UNVERAENDERT.
  SHARE_DILUTION_MIN_RATE: 0.02,
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
// norm(), nicht histOpInc(): firstPresent liest EINEN Wert — das aktuelle Vorzeichen, dieselbe
// Groesse wie der Track-Split (K2-Auflage 1). Der eigene Rueckfall dieser Lampe ist ohnehin die
// TTM-operatingMargin, aus der die synthetische Reihe stammt: beides waere dieselbe Aussage.
function unprofit(s) {
  const op = firstPresent(norm(s, 'annualOpInc'));
  const om = metricVal(s, 'operatingMargin');
  if (op === null && om === null) return null;
  if (op !== null) return op < 0;
  return om < 0;
}

// 2. Burning (juengstes FCF-Jahr negativ) ------------------------------------
// BEWUSSTE DIVERGENZ zu burnAccelerating (F-1, 03.08.2026): burning und shortRunway bleiben
// FREE-CASH-basiert, das Score-druckende Tor (burnAccelerating/burnPressFactor) misst seit F-1
// nur noch den OPERATIVEN Verbrauch. Kein Versehen, sondern zwei verschiedene Fragen:
//   Anzeige  — "geht diesem Namen das Geld aus?" Da zaehlt der GESAMTE Abfluss inklusive
//              Investitionen; wer sein Cash verbaut, hat es trotzdem nicht mehr. Karl braucht
//              das fuers Entry-Timing im Chart.
//   Strafe   — "verschlechtert sich die Einheiten-Oekonomie?" Da darf Bauen nicht zaehlen.
// Folge: ein Nebius-Fall zeigt weiter die Lampe 'burning', bekommt aber keinen Score-Abzug.
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
  // K2-Gate (longitudinale Lampe): cur gegen den Eigen-Schnitt der Vorjahre. Bei computed-margin
  // ist die Margenreihe konstant, cur == histRest -> die Lampe koennte konstruktionsbedingt nie
  // feuern und meldete 'false' als waere das ein Befund. histOpInc macht daraus ein ehrliches null.
  const m = presentValues(ratioSeries(histOpInc(s), norm(s, 'annualRev')));
  const cur = m.length ? m[0] : null;
  const histRest = meanPresent(m.slice(1)); // ohne juengstes (kompaktiert, kein Eigen-Overlap)
  if (cur === null || histRest === null || histRest <= 0) return null;
  return cur > TH.PEAK_MARGIN_MULT * histRest;
}

// 6. ROIC < WACC-Proxy -------------------------------------------------------
function lowRoic(s) {
  // audit/fix (L2): wie capitalEfficiency (E1) — op (alle OpInc-Jahre) und inv (alle assets-Jahre)
  // mittelten ueber verschiedene Jahres-Sets. Jetzt pro Jahr zippen (OpInc present UND assets present).
  // audit/fix (U-SC-003, Tag 556): Quelle NICHT mehr selbst aus Yahoo lesen, sondern
  // roicStabilitySource() der Achsen benutzen — dieselbe Single-Source-Trio-Wahl (tiefe SEC-Serie
  // wo vollstaendig, sonst Yahoo, NIE feldweise gemischt), die capitalEfficiency und roicStability
  // speist. Vorher lief die Anzeige-Lampe auf Yahoo, waehrend die ROIC-ACHSE am selben Namen SEC
  // las -> Lampe und Achse widersprachen sich sichtbar. Reine Anzeige: lowRoic steht nicht in
  // DATA_SUSPECT_LAMPS (score.js) -> kein Score-, kein Exclude-Effekt.
  const { opInc: opS, assets, curLiab } = roicStabilitySource(s);
  const opP = [], invP = [];
  const nYears = Math.max(opS.length, assets.length);
  for (let i = 0; i < nYears; i++) {
    const o = opS[i], a = assets[i];
    if (!Number.isFinite(o) || !Number.isFinite(a)) continue;
    // audit/fix (Bug 30, wie F14 in axes.js): curLiab NICHT zu 0 koerzieren — sonst invested=totalAssets
    // und die Lampe misst still ROA statt ROIC. Jahr nur zaehlen wenn curLiab present UND invested>0.
    const c = curLiab[i];
    if (!Number.isFinite(c)) continue;
    const inv = a - c;
    if (!(inv > 0)) continue;
    opP.push(o); invP.push(inv);
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
  const margins = ratioSeries(histOpInc(s), norm(s, 'annualRev')); // aligned; K2-Gate wie peakMargin
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
  // F-4 (03.08.2026): das "year-ago-Quartal" ist das mit dem passenden ENDDATUM, nicht
  // Position 4 — sonst entlastet (oder belastet) ein Quartal aus einer anderen Saison.
  // Ohne Enden liefert jahresVergleichIdx Position 4 zurueck (unveraendert).
  // BEOBACHTUNGSPUNKT (ausgezaehlt 03.08.2026, 4.768 lokale Snapshots): der Index stammt aus
  // den revenueQ-Enddaten und wird unten AUCH auf opIncQ angewandt — 2.399 Snapshots (50,3 %)
  // haben revenueQ.length !== opIncQ.length, und opIncQEnds existiert in KEINEM Snapshot, die
  // Ausrichtung von opIncQ ist also gar nicht pruefbar. Heute 0 wirksame Faelle (kein einziger
  // laengen-ungleicher Snapshot hat ueberhaupt einen datierten Jahresindex); die Zahl waechst
  // mit der Enddaten-Abdeckung. Wer sie loest, braucht opIncQEnds, nicht mehr Logik hier.
  const vjIdx = jahresVergleichIdx(s, 'revenueQ', 0);
  const r4 = vjIdx ? rev[vjIdx.idx] : null, oi4 = vjIdx ? oi[vjIdx.idx] : null;
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
// audit/fix (Hard-Review AJ-SC-001): repOrig===trade schloss bisher JEDE Same-Currency-Divergenz
// aus, auch den USD/USD-Envelope-Leak (annualRev bleibt trotz USD-Envelope home-currency-grossen
// Massstabs, z.B. ENIC: annualRev[0]/qTTM=x883.7, annualRev[0]/marketCap=x705.2, ttmRatio~0.98 —
// lib/annual-currency-guard.js:90-95 erkennt genau dieses Muster, lamps.js nicht). Portiert den
// dortigen USD/USD-Zweig 1:1 (staerkere Schwelle 20 statt 3, zusaetzlich marketCap-Beleg), NEU
// gerechnet aus den Snapshot-Serien (nicht aus meta._annualCurrencyLeakSuspect gelesen — Kommentar
// oben: pre-A2-Snapshots tragen dieses Flag nicht, alle Daten-Qualitaets-Lampen rechnen deshalb selbst).
const SAME_USD_ANNUAL_TO_QTTM_MIN = 20;
const SAME_USD_ANNUAL_TO_MARKET_CAP_MIN = 10;
function annualCurrencyLeak(s) {
  const meta = s && s.meta;
  if (!meta) return null;
  const repOrig = meta.reportingCurrencyOriginal, trade = meta.tradingCurrency;
  if (!repOrig || !trade) return null;                   // ccy-Felder fehlen -> nicht bewertbar
  const sameUsdEnvelope = repOrig === trade && String(repOrig).toUpperCase() === 'USD';
  if (repOrig === trade && !sameUsdEnvelope) return false; // gleiche Nicht-USD-Waehrung -> kein Leak moeglich
  const a0 = norm(s, 'annualRev')[0];                    // neuestes annual (positional)
  if (!(a0 > 0)) return null;
  const revQ = norm(s, 'revenueQ');
  const q = [];
  for (let i = 0; i < 4; i++) { if (Number.isFinite(revQ[i])) q.push(revQ[i]); }
  if (q.length < 4) return null;                         // volles 4-Q-TTM noetig
  const qTTM = q[0] + q[1] + q[2] + q[3];
  if (!(qTTM > 0)) return null;
  const ratio = a0 / qTTM;
  const ratioMin = sameUsdEnvelope ? SAME_USD_ANNUAL_TO_QTTM_MIN : 3;
  if (!(ratio > ratioMin)) return false;                  // annual nicht inflationiert -> kein Leak
  const revTTM = metricVal(s, 'revenueTTM');
  if (revTTM === null) return null;
  const ttmRatio = revTTM / qTTM;
  if (ttmRatio < 0.6 || ttmRatio > 1.6) return false;    // Quartals-TTM kaputt -> anderes Defekt
  if (sameUsdEnvelope) {
    const marketCap = (s.marketCap && Number.isFinite(s.marketCap.value)) ? s.marketCap.value : null;
    if (!(marketCap > 0)) return null;
    if (!(a0 / marketCap > SAME_USD_ANNUAL_TO_MARKET_CAP_MIN)) return false;
  }
  return true;
}

// F-1 (Karl-Mandat 03.08.2026): die OPERATIVE Cash-Reihe, positionsgetreu (null-Luecken bleiben
// an Ort und Stelle, damit der YoY-Vergleich weiter unten dasselbe Firmenjahr trifft).
// annualOCF direkt, wo vorhanden (95,3 % der Snapshots). Fehlt es an einer Position, wird es aus
// FCF - Capex rekonstruiert — Capex ist durchgehend NEGATIV gespeichert, die Identitaet
// OCF + Capex = FCF haelt an 98,5 % der 11.539 pruefbaren Snapshots (Vorabmessung 03.08.).
// Fehlt eines der beiden Ersatzteile -> null an dieser Position: KEIN Urteil ist besser als ein
// geratener Wert (dieselbe Konvention wie beim fehlenden FCF vorher -> Faktor 1).
function operatingCashSeries(s) {
  const ocf = norm(s, 'annualOCF');
  const fcf = norm(s, 'annualFCF');
  const cap = norm(s, 'annualCapex');
  const n = Math.max(ocf.length, fcf.length, cap.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(ocf[i])) { out.push(ocf[i]); continue; }
    out.push((Number.isFinite(fcf[i]) && Number.isFinite(cap[i])) ? fcf[i] - cap[i] : null);
  }
  return out;
}

// 13. Burn-Beschleunigung (Council/Court, Karl-Direktive): Firma verbrennt OPERATIV Cash UND
// vertieft den operativen Verlust ggue. dem Vorjahres-GJ -> die Einheiten-Oekonomie VERSCHLECHTERT
// sich, trotz evtl. starkem Rueckblick-Wachstum. Vorzeichen-Gate + YoY-Schritt, data-learned (keine
// Magic Number). Turnaround-zu-positiv (CRDO/ALAB/BE: neuestes OCF & OpInc >=0) faellt STRUKTURELL
// aus dem Gate. REIN WARNEND (nicht in DATA_SUSPECT_LAMPS) — die Lampe selbst schliesst nichts aus;
// den Score druckt der davon abgeleitete burnPressFactor.
function burnAccelerating(s) {
  // audit/fix (Hard-Review R1-SC-003): fcf/opi wurden bisher UNABHAENGIG voneinander kompaktiert
  // (presentValues() je Serie separat) -- bei UNTERSCHIEDLICHEN Luecken-Mustern (2038.HK: annualOpInc
  // hat 2 fuehrende Luecken, annualFCF keine) landen positionsfremde Jahre nebeneinander: opi[0]/opi[1]
  // (kompaktiert) waren tatsaechlich FY-2/FY-3, wurden aber gegen fcf[0]/fcf[1] (echtes FY-aktuell/FY-1)
  // verglichen -> feuerte 'true', obwohl kein einziges Jahr tatsaechlich verglichen wurde. Jetzt
  // positionsgebunden auf den ROHEN Serien: Index 0 UND 1 muessen bei BEIDEN Serien am SELBEN Platz
  // present sein, sonst ist der YoY-Vergleich fuer dieses Firmenjahr nicht bewertbar.
  //
  // F-1 (Karl-Mandat 03.08.2026): das Tor steht jetzt auf OCF < 0 statt FCF < 0. FCF ist
  // OCF MINUS Investitionen — ein Tor auf FCF bestraft also die Investition mit. Karls Regel:
  // "Investitionen, die dem Unternehmen zugutekommen, sind nichts Schlechtes; Auszahlungen an
  // Aktionaere schon." Gemessen am CI-Baum 03.08.: von 168 heute Getroffenen haben 36 ein
  // POSITIVES OCF und brennen ausschliesslich, weil sie bauen (Nebius: OCF +385 Mio., Faktor
  // 0,54, Kohorten-Rang 39 statt 1). Die Vertiefungs-Pruefung laeuft aus demselben Grund
  // ebenfalls auf der operativen Groesse: ein groesseres Bauprogramm ist keine
  // Verschlechterung der Einheiten-Oekonomie.
  // K2-Gate: opi[0] gegen opi[1] ist ein Zwei-Jahres-Vergleich (longitudinal) UND er druckt ueber
  // burnPressFactor den Score. Bei computed-margin ist `opi[0] < opi[1]` nichts weiter als
  // `rev[0] < rev[1]`, mit der TTM-Marge als Vorzeichen — eine "sich vertiefende Verlustdynamik",
  // die allein aus der Umsatzbewegung fabriziert waere. histOpInc -> opi leer -> Lampe null ->
  // burnPressFactor exakt 1.0 (kein Abzug aus Fiktion, und auch kein Rescue).
  const ocf = operatingCashSeries(s);
  const opi = histOpInc(s);
  if (!Number.isFinite(ocf[0]) || !Number.isFinite(ocf[1]) || !Number.isFinite(opi[0]) || !Number.isFinite(opi[1])) return null;
  if (!(ocf[0] < 0) || !(opi[0] < 0)) return false;   // Gate: operativ Cash-verbrennend UND operativ unprofitabel
  return ocf[0] < ocf[1] && opi[0] < opi[1];           // beide tiefer als Vorjahr -> Burn/Verlust beschleunigt
}

// Score-Press-Faktor fuer beschleunigte Cash-Verbrenner (Court, Karl-Direktive Teil 2): 1.0 wenn die
// burnAccelerating-Lampe NICHT feuert (Nicht-Feuernde bleiben byte-identisch), sonst 1/(1+mag).
// F-1 (Tag 529): die Groesse ist der OPERATIVE Cash-Fluss, nicht mehr FCF — hier stand bis zum
// 03.08. noch die alte FCF-Formel mit einer Variablen (dBurn = fcf[1]-fcf[0]), die es nicht mehr gibt.
// mag = OCF-Burn-VERTIEFUNG (dBurn = max(0, ocf[1]-ocf[0]); der Boden bei 0 haelt eine VERBESSERUNG
// vom Faktor fern) skaliert an der EIGENEN Cash-Flow-Groesse der Firma max(|rev[1]|,|ocf[0]|,|ocf[1]|).
// Das Gate garantiert ocf[0]<0 -> |ocf[0]|>0 -> Nenner strukturell NIE near-zero (kein
// Stub-Denominator-Artefakt wie JOBY/FRVO). Self-bounded (wie cycleDiscount), keine Magic Number,
// kein Deckel. Veto: CRDO/ALAB/BE feuern nicht (OCF & OpInc positiv) -> Faktor 1.0 -> Score identisch.
function burnPressFactor(s) {
  if (burnAccelerating(s) !== true) return 1;
  // F-1: dieselbe operative Groesse wie im Tor. burnAccelerating hat bereits geprueft, dass
  // Index 0 UND 1 present sind -> direkter Positionszugriff, kein Kompaktieren noetig.
  const ocf = operatingCashSeries(s);
  const rev = presentValues(norm(s, 'annualRev'));
  const dBurn = Math.max(0, ocf[1] - ocf[0]);
  const scale = Math.max(rev.length > 1 ? Math.abs(rev[1]) : 0, Math.abs(ocf[0]), Math.abs(ocf[1]));
  const mag = scale > 0 ? dBurn / scale : 0;
  return 1 / (1 + mag);
}

// 14. Inflations-Verdacht (2.13 / #24): reine Disclosure-WARNUNG — nominales Umsatzwachstum in
// Lokalwaehrung ist in Hoch-Inflations-Laendern inflations-verdaechtig (30% nominal bei 40%
// Inflation = real negativ) und verzerrt die kohorten-relativen Wachstums-Perzentile. VERRECHNET
// NICHTS: nicht in DATA_SUSPECT_LAMPS (score.js) -> kein Score-/Exclude-Effekt, nur Kennzeichnung
// fuers Elliott-Wellen-Chart-Timing. Heute faktisch leer (0 Hoch-Inflations-Reportingwaehrungen im
// Universum), praeventiv fuer den geplanten Universe-Ausbau (Vault _2.13-FAIRNESS-GUARDS-DESIGN).
// Die Listen sind IWF-Referenzfakten (high-inflation-Gruppe, Stand 2026), KEIN Score-Niveau
// (Invariante 3: binaer-deskriptiv wie country.js Land->Region, kein Perzentil-/Korrektur-Wert) —
// jaehrlich von Karl reviewbar. Eine ECHTE nominal->real-Korrektur braeuchte eine CPI-Datenquelle
// = eigener Task mit Karl-OK (nicht hier).
const HIGH_INFLATION_ORIGINS = new Set([
  'Turkey', 'Argentina', 'Egypt', 'Nigeria', 'Pakistan', 'Venezuela', 'Iran',
  'Ghana', 'Ethiopia', 'Angola', 'Zimbabwe', 'Sudan', 'Lebanon',
]);
const REPORTING_CCY_ORIGIN = {
  TRY: 'Turkey', ARS: 'Argentina', EGP: 'Egypt', NGN: 'Nigeria', PKR: 'Pakistan',
  VES: 'Venezuela', VEF: 'Venezuela', IRR: 'Iran', GHS: 'Ghana', ETB: 'Ethiopia',
  AOA: 'Angola', ZWL: 'Zimbabwe', SDG: 'Sudan', LBP: 'Lebanon',
};
function inflationSuspect(s) {
  const m = s && s.meta;
  if (!m) return null;
  const origin = m.country || REPORTING_CCY_ORIGIN[m.reportingCurrency] || null;
  if (!origin) return null;                    // kein Herkunfts-Signal -> nicht bewertbar
  return HIGH_INFLATION_ORIGINS.has(origin);   // true = nominales Wachstum inflations-verdaechtig
}

// 15. Aktienzahl-Verwaesserung (5.2 Small-Cap-Board, Karl E-20260721-4 A1): Kohorten-relative
// Warnung, KEIN Score-Effekt (wie alle Timing-Lampen 1-10). Liest annualShares aus der SEC-
// Tiefenserie (secAnnual, Tag 421/422); hier lokal statt importiert (reine Anzeige-Lampe, kein
// Cross-Modul-Kopplungsrisiko).
//
// REICHWEITE (03.08.2026, der eigene Chunk, den die Kommentar-Korrektur angekuendigt hat):
// Die Lampe las bis hierher NUR secAnnual. Das haengt an ~100 Namen — am lokalen Baum feuerte
// sie damit bei 0 von 3.042 gerouteten Zeilen, also nie. Yahoo traegt dieselbe Groesse in
// 12.418 von 12.501 Snapshots (99,3 %), nur flacher (~4 GJ statt 10-15).
//
// ZWEI NENNER — NICHT VERWECHSELN (nachgemessen 03.08.2026): die 99,3 % sind die ROHE
// Serien-Verfuegbarkeit, gezaehlt ueber ALLE Snapshots des CI-Baums. Sie sagen NICHT, wie oft
// die Lampe eine Aussage machen kann. Die funktionale Reichweite steht auf der Messebene, um
// die es hier geht — den GEROUTETEN Zeilen: von 3.042 (lokaler Baum) tragen 1.732 ueberhaupt
// eine Aktienzahl-Reihe (56,9 %), und 1.721 liefern eine verwertbare Rate (56,6 %).
// Der Abstand 99,3 -> 56,6 kommt NICHT vom Split-Filter — der kostet 11 von 1.732 Zeilen.
// Er kommt aus Messebene (alle Snapshots vs. geroutete Zeilen: lokal 62,0 % -> 56,9 %) und
// Baum (snapshots/ ist seit Tag 151 gitignored, der lokale Baum ist Schutt alter Laeufe und
// duenner als der CI-Baum). Wer die 99,3 % als "so oft wirkt die Lampe" liest, ueberschaetzt
// sie um rund 43 Punkte. Nachmessbar: geroutete Ticker aus scoreUniverse ziehen und
// shareGrowthRate(s) ueber genau diese Menge zaehlen.
// REIHENFOLGE: erst die TIEFE SEC-Serie, dann Yahoo. Tiefe schlaegt Breite, wo beide da sind —
// der Median ueber mehr Jahre ist robuster gegen ein einzelnes Sonderjahr.
//
// ⚠ BEOBACHTUNG (b), 03.08.2026 — NUR NOTIERT, NICHT GEBAUT: DIE ZWEI REIHEN ZAEHLEN NICHT
// DASSELBE. Aus dem Code gelesen, nicht geraten:
//   secAnnual.annualShares <- merge-sec-xbrl.js SHARE_CONCEPTS: dei:EntityCommonStockShares-
//     Outstanding > us-gaap:CommonStockSharesOutstanding > WeightedAverageNumberOfShares-
//     OutstandingBasic  ==> AUSSTEHENDE / BASIC Aktien.
//   annual.annualShares <- pull-yahoo.js: dilutedAverageShares > basicAverageShares > FTS-
//     Bilanz  ==> in aller Regel die DILUTED-Reihe.
// Die verduennte Reihe folgt der EPS-Methodik: sie enthaelt Optionen/RSUs und bei Up-C-
// Strukturen (Holding + LLC, umtauschbare Einheiten) springt sie zwischen Jahren um einen
// Faktor, ohne dass eine einzige Aktie ausgegeben wurde. Am 03.08. an CWH direkt aus den
// SEC-Zahlen belegt: die diluted-Reihe oszilliert um Faktor ~2, die reale Basis wuchs +0,3 %.
// Eine solche Zeile feuert die Lampe, ohne dass jemand verwaessert wurde.
// GEMESSEN, wie gross die betroffene Population sein KANN (nicht wie gross sie IST — das
// entscheidet erst der Vergleich, den die Daten nicht hergeben):
//   CI-Bestand 03.08. (10.722 Snapshots, 5.793 geroutete Zeilen, 1.446 Feuerungen):
//     1.426 von 1.446 Feuerungen (98,6 %) ranken auf der DILUTED-Reihe — sie sind die
//     Risikopopulation. Nur 20 haben ueberhaupt eine SEC/Basic-Reihe und sind strukturell immun.
//     Fuer die 1.426 ist die Frage "diluted vs. basic" NICHT beantwortbar: der Snapshot traegt
//     nur die eine Reihe. Wo beide vorliegen (20 Zeilen), betraegt die Divergenz der Raten
//     im Median 2,54 pp, im Extrem FLNC 8,4 % (basic) gegen 58,0 % (diluted) — Faktor 7.
//     Die enge CWH-Form (ein starkes Auf UND ein starkes Ab in derselben Reihe) trifft je nach
//     Schnitt 9 bis 26 Zeilen; beim weitesten Schnitt liegen 25 von 26 auf der diluted-Reihe.
//   Lokaler Baum (3.042 geroutete Zeilen, 437 Feuerungen): 421 diluted, 16 SEC, 2-4 Schwinger.
// WARUM HIER NICHTS GEAENDERT WIRD: die Quellenwahl basic vs. diluted ist eine METHODIK-Frage
// (welcher Begriff von "Verwaesserung" gemessen werden soll), nicht ein Anzeige-Fix. Sie
// gehoert vor Karl bzw. den Court, nicht in einen Anzeige-Chunk. Nachmessbar mit den beiden
// Reihen je Snapshot; die Zahlen oben stammen aus genau dieser Auszaehlung.
// GEMISCHTE KOHORTEN sind hier vertretbar: verglichen werden RATEN (Median der organischen
// YoY-Beine), keine Niveaus, und der Split-Guard in shareYoYLegs greift fuer beide Quellen
// gleich. Eine tiefe und eine flache Reihe liefern denselben Begriff, nur unterschiedlich
// robust — das ist Praezision, keine Vergleichbarkeitsluecke.
//
// ⚠ BEOBACHTUNG (a), 03.08.2026 — NUR NOTIERT, NICHT GEBAUT, UND ZUR HAELFTE WIDERLEGT.
// Die Vermutung lautete: eine flache 4-Jahres-Reihe rauscht staerker als eine 14-Jahres-Reihe,
// also muessten Yahoo-Namen unter den Feuerungen ueberrepraesentiert sein — und das Perzentil
// muesste vielleicht je Quellen-Tiefe getrennt ranken.
// Der TIEFENUNTERSCHIED ist real und gemessen (CI-Bestand 03.08.): Median-Tiefe der rankenden
// Reihe 14,5 Geschaeftsjahre bei SEC gegen 5 bei Yahoo.
// DIE UEBERREPRAESENTATION IST ES NICHT. Gegen die Basisrate gerechnet — Anteil der Quelle
// unter ALLEN bewertbaren Zeilen (die bilden die Kohorte) gegen den Anteil unter den
// feuernden — feuern beide Quellen praktisch auf ihrer Erwartung von 25 % (die Lampe ist p75):
//   CI-Bestand : SEC 20 von 74 = 27,0 %  ·  Yahoo 1.426 von 5.678 = 25,1 %
//   lokaler Baum: SEC 16 von 79 = 20,3 %  ·  Yahoo 421 von 1.642 = 25,6 %
// Die Richtung DREHT SICH zwischen den beiden Baeumen, und beide Male haengt sie an einer
// SEC-Teilmenge von unter 80 Namen. Daraus laesst sich kein Bias ableiten.
// FOLGE FUER DEN VORSCHLAG "getrennt je Quellen-Tiefe ranken": er ist an diesem Bestand nicht
// baubar. Die SEC-Teilmenge sind 74 Namen (1,3 % der Kohorte), verteilt auf 27 Boards mal zwei
// Tracks — die meisten Kohorten haetten null oder einen Namen, und buildShareGrowthPctlFn
// liefert dort per Degenerations-Guard null. Man wuerde die Lampe fuer genau die Namen mit der
// BESTEN Datenlage abschalten. Entschieden wird das trotzdem nicht hier: Kohortenbildung ist
// Methodik und gehoert vor Karl/Court.
// ERLAUBT IST DAS, WEIL DIE LAMPE NICHTS VERRECHNET: sie steht nicht in DATA_SUSPECT_LAMPS
// (score.js) und wird in runSmallcapPass erst NACH scoreUniverse an lamps[] angehaengt — der
// Score ist da laengst gerechnet und wird nicht neu gerechnet. Beleg: score-digest.js,
// Gesamt-Digest vor und nach dieser Aenderung identisch.
function annualSharesSeries(s) {
  const raw = s && s.secAnnual && s.secAnnual.annualShares;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((e) => { const v = (e && typeof e === 'object') ? e.value : e; return Number.isFinite(v) ? v : null; });
  }
  const yahoo = norm(s || {}, 'annualShares');
  return yahoo.length > 0 ? yahoo : null;
}

// Split/Reverse-Split-Guard: eine ECHTE organische Jahres-Verwaesserung (SBC/Secondary) verdoppelt
// oder halbiert die Aktienzahl nicht binnen EINES Jahres — ein Sprung ausserhalb [1/2, 2] ist die
// Split-Signatur (Roh-Aktienzahl-Sprung, keine Verwaesserung), oekonomisch begruendeter Deckel wie
// OPMARGIN_CAP (score.js), keine data-gefittete Magic Number. Live-verifiziert an GME: die Serie
// zeigt den echten 4-fuer-1-Split (Juli 2022) als Ratio~3.989 zwischen zwei GJ — dieses Bein faellt
// sauber raus, die uebrigen organischen Beine (0..10%, ein Ausreisser 46%) bleiben.
function shareYoYLegs(series) {
  const legs = [];
  for (let i = 0; i + 1 < series.length; i++) {
    const cur = series[i], prev = series[i + 1];
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) continue;
    const ratio = cur / prev;
    // Rat 04.08.2026 (Stufe A, _RAT-52-VERWAESSERUNG-2026-08-04.md): beidseitig EINSCHLIESSEND
    // (>= / <=, vorher > / <). Ein exakter Genau-Faktor-2-Sprung (ratio===2 bzw. ===0.5) ist
    // dieselbe Split-Signatur wie jeder groessere Sprung — ihn knapp UNTERHALB des Deckels als
    // "organisches Bein" durchzulassen waere eine Zufallsluecke am Rand, keine bewusste Grenze.
    if (ratio >= TH.SHARES_ORGANIC_CAP || ratio <= 1 / TH.SHARES_ORGANIC_CAP) continue; // Split-Signatur
    legs.push(ratio - 1);
  }
  return legs;
}

// Aktienzahl-Wachstumsrate einer Firma = Median der organischen (split-bereinigten) YoY-Beine (wie
// robustG: Median statt Einzeljahr, damit ein Ausreisser-Jahr die Aussage nicht kippt). Kein
// organisches Bein -> null (nicht bewertbar, z.B. reiner Split-Serie ohne Zwischenjahre).
function shareGrowthRate(s) {
  const series = annualSharesSeries(s);
  if (!series) return null;
  const legs = shareYoYLegs(series);
  return legs.length ? _median(legs) : null;
}

// Kohorten-Perzentil-Funktion ueber die shareGrowthRate-Verteilung EINER Kohorte (vom Board-Bau
// uebergeben, s. run-screener.js/5.2-Board — dieselbe Rang-Methode wie growthPctlFn in score.js:
// pctl = Anteil strikt kleinerer Werte). Degenerations-Guard analog (n<2 oder komplett gleich -> null).
function buildShareGrowthPctlFn(cohortSnapshots) {
  const finite = (cohortSnapshots || []).map(shareGrowthRate).filter(Number.isFinite).sort((a, b) => a - b);
  const n = finite.length;
  if (n < 2 || finite[0] === finite[n - 1]) return null;
  return (g) => {
    let lo = 0;
    for (const x of finite) { if (x < g) lo++; else break; }
    return lo / (n - 1);
  };
}

// shareDilutionDetail(s, ctx) -> {rate, pctl} | null — die ROHEN Zahlen hinter der Lampe:
// `rate` = Median-YoY der organischen Beine (Anteil, nicht Prozent), `pctl` = Rang dieser Rate in
// der Kohorte. Sie werden gebraucht, weil die Lampe allein nur an/aus sagt: seit dem
// Reichweiten-Fix (Tag 536) feuert sie fuer 437 von 3.042 gerouteten Zeilen, und darunter sieht
// der Kohorten-Spitzenreiter mit +1 % Aktienzahl im Jahr exakt aus wie einer mit +66 %.
// EIN RECHENWEG: shareCountDilution liest seine Schwelle an genau diesem Ergebnis ab und rechnet
// nichts Eigenes mehr. Zwei Wege zur selben Aussage laufen irgendwann auseinander — genau die
// Falle, die score.js F-4 dreimal nachgebaut vorgefunden hat.
// UNGERUNDET, absichtlich: der Schwellvergleich laeuft auf dem rohen `pctl`. Wuerde hier schon
// gerundet, kaeme eine Zeile mit p=0,7495 als 0,75 durch und die Lampe feuerte neu — eine
// Schwellenaenderung durch die Hintertuer. Gerundet wird erst bei der Ausgabe
// (run-screener.js lampeBNachruesten), wo es die Anzeige betrifft und nicht die Entscheidung.
function shareDilutionDetail(s, ctx) {
  const g = shareGrowthRate(s);
  if (g === null) return null;
  const pctlFn = ctx && ctx.shareGrowthPctlFn;
  if (typeof pctlFn !== 'function') return null;
  const p = pctlFn(g);
  if (!Number.isFinite(p)) return null;
  return { rate: g, pctl: p };
}

// shareCountDilution(s, ctx): ctx.shareGrowthPctlFn ist die Kohorten-Perzentil-Funktion (vom Aufrufer
// gebaut, s.o.) — OHNE ctx (z.B. HG/QC-Board, die Lampe B nicht verdrahten) liefert die Lampe null
// (nicht bewertbar), byte-identisch zum bisherigen Verhalten dort.
// Rat 04.08.2026 (Stufe A): KONJUNKTION statt reinem Kohorten-Rang — Kohorten-p75+
// (TH.SHARE_DILUTION_PCTL) UND eine Rate, die ueberhaupt eine Verwaesserung TRAEGT
// (TH.SHARE_DILUTION_MIN_RATE, s. Konstante). Ein reiner Rang-Vergleich feuert sonst auch fuer die
// schwaechste Zeile einer schrumpfenden Kohorte (negative Rate, trotzdem p75+ — MGPI-Klasse).
// shareDilutionDetail() selbst bleibt die ROHE Rechnung, unveraendert (die Anzeige zeigt weiter
// die echte Rate/das echte Perzentil, auch wenn die Lampe wegen der Rate-Schranke nicht feuert).
function shareCountDilution(s, ctx) {
  const d = shareDilutionDetail(s, ctx);
  if (d === null) return null;
  return d.pctl >= TH.SHARE_DILUTION_PCTL && d.rate >= TH.SHARE_DILUTION_MIN_RATE;
}

// 16. Einmalertrag (Karl-Sichtabnahme 27.07.2026): ein einzelnes Quartal traegt den ganzen
// Jahresumsatz — typisch fuer Lizenz-, Meilenstein- oder Verkaufserloese, die als Umsatz
// gebucht werden. Fuer einen Wachstums-Screener sehen solche Firmen wie Spitzenwerte aus,
// obwohl nichts davon wiederkehrt.
//
// DER ANLASS: Zealand Pharma stand am 27.07. auf Rang 1 der Uebersicht, Score 100,1, mit
// sechs Achsen ueber dem 99. Perzentil. Grundlage waren die Quartalsumsaetze 5 / 10 / 8 /
// 1.382 Mio. — ein einziger Buchungsvorgang (Lizenzertrag). Karl fiel es beim Draufschauen
// auf, dem Screener nicht.
//
// WARUM UEBER QUARTALE UND NICHT UEBER DIE JAHRESREIHE: ein echter Hypergrowth kann auch das
// Fuenffache wachsen — die Jahresreihe allein kann beides nicht trennen. Der Unterschied ist
// die WIEDERHOLBARKEIT, und die steht in den Quartalen: ein Einmalertrag ist EIN Ausreisser,
// echtes Wachstum ist getragen.
//
// DIE SCHWELLE ist strukturell, kein Marktniveau (Invariante 3, wie bei inflationSuspect):
// 0,50 heisst "ein Quartal traegt so viel wie die anderen drei zusammen". Bei vier gleich
// grossen Quartalen liegt der Wert bei 0,25 — das ist die natuerliche Referenz, nicht eine
// gelernte. Am ausgelieferten Bestand des 27.07. gemessen (151 Zeilen mit vier verwertbaren
// Quartalen): Median 0,301, p90 0,374, und nur FUENF Zeilen ueber 0,50 (ZEAL.VI 0,983,
// ABUS 0,936, 688336.SS 0,742, BEAM 0,696, 2451.TW 0,511).
//
// GEGENPROBE an genau den Firmen, die Karl sehen WILL: CRDO 0,327 · ALAB 0,308 · BE 0,318 ·
// NVDA 0,322 · PLTR 0,313 · CELH 0,264 · DAVE 0,271 — alle weit im Normalbereich, kein
// Fehlalarm.
//
// SAISON-SCHUTZ: ein Weihnachtsgeschaeft kann ein Quartal legitim dominieren. Liegen acht
// Quartale vor und ist DASSELBE Quartal auch im Vorjahr das groesste, ist es Saison und die
// Lampe schweigt. Nur bei einem Ausreisser OHNE Vorjahres-Entsprechung feuert sie.
//
// SEIT DEM URTEIL VOM 16.08.2026 IST DIE LAMPE FOLGENREICH (F-16-Einzelfreigabe Karl).
// Bis dahin stand hier "VERRECHNET NICHTS". Das stimmt nicht mehr: brennt sie, droppt
// score.js die fuenf vom Sprung getragenen Achsen dieser Zeile (EINMALERTRAG_BLIND), und
// renorm-on-drop + C4-Coverage-Shrinkage ziehen den Score Richtung Kohorten-Median.
// WAS UNVERAENDERT GILT: nicht in DATA_SUSPECT_LAMPS -> KEIN Exclude, die Zeile bleibt
// sichtbar und geroutet. Kein Abzug, kein gesetzter Wert — nur "diese Achsen sind fuer
// diese Zeile nicht bewertbar". Die Begruendung steht bei EINMALERTRAG_BLIND in score.js.
const EINMALERTRAG_ANTEIL = 0.50;
// Ein Quartal ist verwertbar, wenn eine positive Zahl drinsteht. EINE Definition fuer
// einmalertrag() UND einmalertragBewertbarkeit(): die zweite Funktion beschriftet die
// null-Ausgaenge der ersten, und beschriftet falsch, sobald beide verschieden zaehlen
// (dann meldet sie 'ungleicheKadenz', wo 'zuWenigQuartale' richtig waere, oder umgekehrt).
const quartalBrauchbar = (v) => Number.isFinite(v) && v > 0;
function einmalertrag(s) {
  // ⚠ Bewusst die ROHE Reihe (mit Luecken), NICHT presentValues: der Saison-Vergleich unten
  // stellt Quartal gegen Quartal, und presentValues wuerfe Luecken heraus und damit die
  // Positionen durcheinander — Q4 laege dann gegen Q3 des Vorjahres.
  const roh = norm(s, 'revenueQ');
  const letzte4 = roh.slice(0, 4);
  if (letzte4.length < 4 || !letzte4.every(quartalBrauchbar)) return null;   // nicht bewertbar, nicht "sauber"
  // 29.07.: UNGLEICHE PERIODENLAENGEN sind nicht vergleichbar.
  // Bei chinesischen A-Aktien und weiteren Boersen fehlt in der Quartalsreihe das
  // September-Quartal; die Enden lauten dann z. B. 2026-03-31 / 2025-12-31 / 2025-06-30 /
  // 2025-03-31 — Abstaende 3, 6, 3 Monate. Der Halbjahres-Eintrag deckt ZWEI Quartale ab,
  // ist mechanisch doppelt so gross und reisst die 50-%-Marke ohne jeden Einmalertrag.
  // Zwei unabhaengige Pruefungen haben das getrennt gemessen: von 19 geflaggten Zeilen mit
  // pruefbaren Enden erlischt die Lampe bei 18, sobald man den Halbjahres-Eimer aufloest.
  // Fuenf davon standen im Kopf ihres Boards (688336.SS auf Rang 3 mit Anteil 0,742 gegen
  // 0,401 nach Aufloesung).
  //
  // VERWORFEN statt AUFGELOEST: den Eimer rechnerisch zu halbieren waere eine erfundene
  // Zahl, und in diesem Projekt wird nichts fabriziert. Eine Reihe mit ungleicher Kadenz
  // ist schlicht nicht bewertbar -> null, nicht false.
  // PREIS, offen benannt: dabei fallen auch die echten Faelle unter diesen Firmen heraus
  // (gemessen: einer von 19, BURE.ST). Das ist der richtige Tausch — ein Anteil, dessen
  // Nenner aus verschieden langen Perioden besteht, sagt nichts, auch wenn er zufaellig
  // richtig liegt.
  //
  // Die Enden werden DIREKT gelesen, nicht ueber norm(): es sind ISO-Datums-Strings, und
  // norm() ist auf Zahlenserien gebaut (toFinite -> null). Defensiv: fehlen die Enden
  // (Snapshots vor der A10-Erweiterung tragen sie nicht), wird NICHT geraten — dann laeuft
  // die Lampe wie bisher, statt eine ganze Alt-Population stumm zu schalten.
  const enden = (s && s.timeseries && Array.isArray(s.timeseries.revenueQEnds))
    ? s.timeseries.revenueQEnds.slice(0, 4) : null;
  if (enden && enden.length === 4 && enden.every((d) => typeof d === 'string' && d)) {
    const TAG = 86400000;
    for (let i = 0; i + 1 < 4; i++) {
      const a = Date.parse(enden[i] + 'T00:00:00Z');
      const b = Date.parse(enden[i + 1] + 'T00:00:00Z');
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;   // unlesbares Datum: nicht raten
      const tage = (a - b) / TAG;
      if (!(tage >= 75 && tage <= 105)) return null;                 // kein Quartalsabstand
    }
  }
  const summe = letzte4.reduce((a, b) => a + b, 0);
  if (!(summe > 0)) return null;
  const groesster = Math.max(...letzte4);
  if (groesster / summe < EINMALERTRAG_ANTEIL) return false;

  // Anlauf-Schutz (Rat + Gericht 28.07., Urteil _URTEIL-EINMALERTRAG-2026-07-28.md):
  // Steigt die Reihe vom aeltesten zum neuesten Quartal monoton, ist der Sprung das Ende
  // eines Anstiegs und kein Einmalertrag. Ein Anlauf mit rund +84 % je Quartal reisst die
  // 50-%-Marke rein arithmetisch (r^3 >= 1+r+r^2), ohne dass etwas Einmaliges passiert
  // waere — und der Saison-Schutz unten greift dort NICHT, weil im Vorjahr noch kaum
  // Umsatz stand. Genau diese Form haben die Firmen, die Karl finden will.
  // An der CI-Kohorte gemessen: 12 der 65 geflaggten Zeilen sind solche Anlaeufe, u. a.
  // 2451.TW (92 -> 100 -> 211 -> 422, stand auf Uebersichts-Rang 28) und ONDS (6 -> 10 -> 30 -> 50).
  // GEGENPROBE (durchgefuehrt): Regel deaktiviert -> zwei Waechter-Tests rot.
  const altZuNeu = [...letzte4].reverse();
  if (altZuNeu.every((v, i) => i === 0 || v >= altZuNeu[i - 1])) return false;

  // Saison-Schutz Teil 1 (29.07.): der EINZELNE Vorjahres-Wert desselben Quartals.
  // Der Block-Test unten verlangt VIER verwertbare Vorjahresquartale. Der Bestand traegt
  // aber meist nur fuenf Quartale insgesamt — dann ist roh.slice(4,8) nie vollstaendig und
  // der Saison-Schutz lief praktisch nie. Belegt an H&R Block (HRB): Quartale
  // 2.398 / 199 / 204 / 1.111 / 2.277 Mio, Anteil 0,60 -> Lampe an, obwohl das
  // Vorjahresquartal 95 % der Spitze erreicht. Ein Steuersaison-Geschaeft als
  // "Einmalertrag" zu fuehren ist genau der Fehlalarm, den die Lampe vermeiden soll.
  //
  // Der direkte Test braucht nur EINEN Wert statt vier: war dasselbe Quartal im Vorjahr
  // schon mindestens halb so gross wie die jetzige Spitze, ist das Saison. Dieselbe
  // Konstante wie oben, KEIN neuer Schwellwert — 0,50 heisst hier "das Vorjahresquartal
  // erreicht mindestens die Haelfte der Spitze".
  //
  // Der Anlassfall bleibt betroffen: Zealands Spitze liegt an Position 3, das
  // Vorjahresquartal waere Position 7 und fehlt -> keine Entlastung, die Lampe brennt.
  //
  // F-4 (03.08.2026): "Position 7" hiess bis heute woertlich Index 7. Fehlt in der Reihe
  // weiter hinten ein Quartal, sprach dort ein FREMDES Quartal die Zeile frei. Der Partner
  // kommt jetzt aus dem Enddatum; ohne Enden bleibt es Index spitzeIdx+4.
  const spitzeIdx = letzte4.indexOf(groesster);
  const vjIdx = jahresVergleichIdx(s, 'revenueQ', spitzeIdx);
  const vorjahresQuartal = vjIdx ? roh[vjIdx.idx] : null;
  if (quartalBrauchbar(vorjahresQuartal) && vorjahresQuartal >= EINMALERTRAG_ANTEIL * groesster) return false;

  // Saison-Schutz Teil 2: dominiert im Vorjahr DASSELBE Quartal ebenso stark, ist es Saison
  // und kein Einmaleffekt. Fehlt das Vorjahr, wird nicht geraten — dann bleibt es beim Verdacht.
  // F-4: der Block-Vergleich stellt Quartal gegen Quartal ueber die POSITION — das gilt nur,
  // wenn zu jedem der vier juengsten Quartale der Jahrespartner wirklich vier Plaetze weiter
  // hinten steht. Ohne Enden ist die Pruefung true (unveraendert).
  const vorjahr = roh.slice(4, 8);
  if (vorjahr.length === 4 && vorjahr.every(quartalBrauchbar) && jahresFensterAusgerichtet(s, 'revenueQ', 4)) {
    const groessterVorjahr = Math.max(...vorjahr);
    const anteilVorjahr = groessterVorjahr / vorjahr.reduce((a, b) => a + b, 0);
    if (letzte4.indexOf(groesster) === vorjahr.indexOf(groessterVorjahr)
        && anteilVorjahr >= EINMALERTRAG_ANTEIL) return false;
  }
  return true;
}

// ── Prognose-Zustand zur Einmalertrags-Lampe (F-2 Stufe 1, 03.08.2026) ──────────────────
// findash zeigt zu jeder markierten Zeile an, ob der Sprung nach heutigem Stand wiederkommt,
// und liest dafuer rows[].einmalertragPrognose (findash/data-layer/lamp-legend.js,
// einmalertragZustand()). Der Zustand wird hier erzeugt, NICHT in findash geraten.
//
// ⛔ WAS DIESE FUNKTION HEUTE NICHT TUT: urteilen. Die beiden urteilenden Zustaende
// 'bestaetigt'/'eingebrochen' verlangen eine Einbruchs-SCHWELLE ("wieviel weniger ist
// deutlich weniger"). Die ist weder gelernt noch praeregistriert, und
// scripts/einmalertrag-trefferquote.js hat am 29.07. vorgefuehrt, was eine frei gewaehlte
// Schwelle wert ist: das Vorzeichen des Befunds haengt daran, wo man sie hinlegt. Eine
// "vorlaeufige" Schwelle waere genau der Verstoss gegen Invariante 3 (keine aufgezwungenen
// Niveaus). Stufe 1 liefert deshalb nur, was OHNE Schwelle wahr ist: ob die Frage
// ueberhaupt beantwortbar ist.
//
// DIE DREI AUSGAENGE, jeder aus den Daten abgeleitet (nicht gesetzt):
//   null            — die Zeile traegt die Lampe nicht (es gibt nichts zu sagen), ODER die
//                     Prognose ist vollstaendig und vergleichbar: dann ist das Urteil faellig,
//                     aber es fehlt die Schwelle. Kein Zustand ist ehrlicher als ein falscher;
//                     findash faellt hier auf seinen dokumentierten Fall D zurueck. GENAU
//                     DIESE Zeilen fuellt Stufe 2 mit bestaetigt/eingebrochen.
//   'nichtPruefbar' — keine verwertbare Umsatzprognose fuer das naechste Geschaeftsjahr
//                     (external.revenueEstimates fehlt oder traegt kein '+1y'). pull-yahoo.js
//                     speichert eine Periode nur mit numberOfAnalysts > 0 UND avg > 0; alles
//                     andere ist dort schon als Fehlstelle aussortiert.
//   'nichtAnwendbar'— Schaetzung vorhanden (Analysten + avg), aber die Quelle liefert keine
//                     Veraenderung: growth === null. pull-yahoo.js benennt diesen Fall
//                     woertlich ("LFTO: 14 Analysten, gefuellter avg, growth null — ein
//                     Rechenartefakt der Quelle ... = nicht anwendbar"); findashs Legendentext
//                     zu nichtAnwendbar sagt dasselbe.
//
// WARUM '+1y' UND KEINE ANDERE PERIODE: die Frage lautet "kommt so etwas wieder", und das
// beantwortet nur das NAECHSTE Geschaeftsjahr. Am lokalen Bestand nachgesehen (nicht geraten):
// die Perioden heissen 0q/+1q/0y/+1y, '+1y' liegt auf 2.309 von 2.314 abgedeckten Titeln.
//
// KEINE LAMPE: bewusst NICHT in LAMPS — evaluateLamps bleibt unveraendert, die Lampenliste
// jeder Zeile ist byte-identisch. Reine Anzeige, kein Score-Input.
const EINMALERTRAG_PROGNOSE_PERIODE = '+1y';
function einmalertragPrognose(s, lampeAktiv) {
  if (lampeAktiv !== true) return null;
  const re = s && s.external && s.external.revenueEstimates;
  const p = (re && typeof re === 'object') ? re[EINMALERTRAG_PROGNOSE_PERIODE] : null;
  // Object.prototype-Namen ('toString') duerfen nie als Prognose durchgehen.
  if (!p || typeof p !== 'object' || !(p.avg > 0) || !(p.numberOfAnalysts > 0)) return 'nichtPruefbar';
  if (!Number.isFinite(p.growth)) return 'nichtAnwendbar';
  return null; // vollstaendig und vergleichbar -> Urteil erst mit der Schwelle aus Stufe 2
}

// ── Bewertbarkeits-Zustand zur Einmalertrags-Lampe (Urteil 16.08.2026, Sichtbarkeits-Stufe) ──
// DAS PROBLEM: einmalertrag(s) hat drei Ausgaenge, aber findash sah nur zwei. true = Lampe an,
// false = geprueft und sauber, null = NICHT BEWERTBAR — und null kam bisher stumm an, ununter-
// scheidbar von "sauber". Drei verschiedene Lagen lieferten dasselbe Schweigen. Genau daran
// haengt die Schein-Sauberkeit von 2548.TW (real-estate Rang 1) und 298380.KQ (Rang 5): sie
// stehen ungepruefft oben und sehen aus wie geprueft.
//
// ⚠ REINE ANZEIGE, wie einmalertragPrognose: der Rueckgabe-Vertrag von einmalertrag() bleibt
// unveraendert, LAMPS bleibt unveraendert, evaluateLamps bleibt byte-identisch. Kein
// Score-Input — die Verdrahtung in score.js haengt an der brennenden LAMPE, nicht hieran.
//
// DIE GRUENDE kommen aus denselben Daten wie die null-Ausgaenge der Lampe, nicht aus einer
// zweiten Regel:
//   'zuWenigQuartale'  — keine vier verwertbaren Quartale im Fenster (Luecke, 0, negativ).
//   'ungleicheKadenz'  — vier Quartale da, aber die Enden liegen nicht im Quartalsabstand
//                        (Halbjahres-Eimer bei CN-A-Aktien u. a.) oder ein Datum ist unlesbar.
// Die Reihenfolge spiegelt die Reihenfolge der Pruefungen in einmalertrag(): erst Vollstaendig-
// keit, dann Kadenz. Bewertbar (true ODER false) -> null, es gibt nichts anzuzeigen.
function einmalertragBewertbarkeit(s) {
  if (einmalertrag(s) !== null) return null;             // bewertbar: Lampe hat geurteilt
  const letzte4 = norm(s, 'revenueQ').slice(0, 4);
  if (letzte4.length < 4 || !letzte4.every(quartalBrauchbar)) return 'zuWenigQuartale';
  return 'ungleicheKadenz';
}

// --- 17+18: OpInc-HERKUNFTS-Lampen (Urteil T164, K2-Auflage 3 / K1-Doppelboden) ---------------
// ⚠ AUSDRUECKLICH NICHT in DATA_SUSPECT_LAMPS (score.js). Das ist keine Formalie, sondern der
// woertliche Auflagentext beider Richter: `opIncSynthetisch` steht heute an 300 der 354 Zeilen des
// Financials-Boards. In der Exclude-Liste waere sie ein 300-Zeilen-Ausschluss durch die Hintertuer
// — genau die "Board-Ausweidung ohne Ersatz", die das Gericht mit 3:0 verboten hat (SEC-Alternative
// existiert fuer 8 von 1.883 Namen). Die drei Coverage-1/7-Namen behalten ihren Restscore, sichtbar
// gekennzeichnet (K2-Auflage 6). Wer diese Namen hier eintraegt, kippt das Urteil.
//
// Warum ZWEI Lampen und nicht ein Herkunfts-Feld: Lampen sind der einzige Kanal, der bereits an
// JEDER Board-Zeile haengt (score.js:1421/1437, findash-Export). Bis heute erreichte
// meta.opIncSource die Engine ueberhaupt nicht (K3-Auflage 3: grep in src/scoring = 0 Treffer ueber
// 31 Dateien, von R1 und R2 unabhaengig verifiziert) — das Etikett existierte nur im Store.

// 17. (B2) Die Jahres-OpInc-Reihe ist zurueckgerechnet (annualRev x operatingMargins-TTM), nicht
// gemeldet. Genau die Reihe, die das K2-Gate oben aus allen historischen Auswertungen heraushaelt.
function opIncSynthetisch(s) {
  if (!s || !s.meta || s.meta.opIncSource === undefined || s.meta.opIncSource === null) return null;
  return opIncSynthetic(s);
}

// 18. (B4) K1-Doppelboden (R1): die Reihe stammt aus Yahoos still und unversioniert bereinigtem
// Stream, nicht aus dem eingereichten Abschluss. K1 hat 2:1 GAAP-as-filed zur Scoring-Definition
// erklaert; wo keine SEC-Serie existiert, bleibt die Yahoo-Reihe als ehrlich etikettierter Proxy
// stehen (K1-Auflage 3: kein Name verliert Daten). Diese Lampe sagt, welcher Fall vorliegt.
// Sie feuert breit — das IST der K1-Befund und keine Fehlkalibrierung: der Store traegt 12.629
// yahoo-adjusted gegen 128 sec-gaap (Migration 29.08., PR #90).
function opIncYahooAdjusted(s) {
  if (!s || !s.meta || s.meta.opIncSource === undefined || s.meta.opIncSource === null) return null;
  return s.meta.opIncSource === 'yahoo-adjusted';
}

const LAMPS = {
  unprofit, burning, shortRunway, highDilution, peakMargin,
  lowRoic, arDivergence, crashRisk, fcfArtefact, cyclePeak,
  burnAccelerating,
  newestQtrSuspect, annualCurrencyLeak,
  inflationSuspect,
  shareCountDilution,
  einmalertrag,
  opIncSynthetisch, opIncYahooAdjusted,
};

/**
 * evaluateLamps(s, ctx) -> { flags: {name:bool|null}, active: [names mit true] }
 * Reine Anzeige — fliesst NIE in den Score ein. ctx ist optional (Kohorten-Kontext fuer Lampen wie
 * shareCountDilution) — die Lampen 1-14 haben Stellenzahl 1 und ignorieren ctx (byte-identisch).
 */
function evaluateLamps(s, ctx) {
  const flags = {};
  const active = [];
  for (const [name, fn] of Object.entries(LAMPS)) {
    const v = fn(s, ctx);
    flags[name] = v;
    if (v === true) active.push(name);
  }
  return { flags, active };
}

module.exports = {
  evaluateLamps, burnPressFactor, LAMPS, TH, ...LAMPS,
  shareGrowthRate, buildShareGrowthPctlFn, shareDilutionDetail,
  einmalertragPrognose, EINMALERTRAG_PROGNOSE_PERIODE,
  einmalertragBewertbarkeit,
};
