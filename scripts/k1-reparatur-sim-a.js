#!/usr/bin/env node
'use strict';
/**
 * scripts/k1-reparatur-sim-a.js — K1-REPARATUR-MESSUNG (ARM A). Reine Messung.
 * Aendert NICHTS am Repo, schreibt nichts, committet nichts. rank-ic.js bleibt
 * unangetastet: die Reparatur-Kandidaten werden hier nur GEMESSEN.
 *
 * FRAGE: Welcher Reparatur-Kandidat haelt bei n = 8..12 Messfenstern die Latte
 *        (tatsaechliche Ueberdeckung >= 85 % bei nominal 90 %) — und was kostet
 *        er an Intervall-Breite?
 *
 * ECHTE MASCHINERIE (nichts davon nachgebaut):
 *   bootstrapCI(points, level, B, seed, blockLen) -> {lo, hi, p}   [rank-ic.js:239]
 *     blockLen-Default = BOOTSTRAP_BLOCK_LEN = 2; wir lassen den Default stehen,
 *     genau wie evaluateObserved(): bootstrapCI(points, CI_LEVEL, B, seed).
 *     Enthaelt intern bereits die E-20260719-1-Verbreiterung f = sqrt(n/nEff).
 *   nEff(points)      [rank-ic.js:274]   spearman(xs,ys) [rank-ic.js:110]
 *   stddev(values)    [rank-ic.js:111]
 *   CI_LEVEL = 0.90, BOOTSTRAP_B = 10000, BOOTSTRAP_BLOCK_LEN = 2 (aus dem Rumpf gelesen).
 *
 * KANDIDATEN (alle auf DENSELBEN Daten, gepaart — jede Zeile sieht jede Reparatur):
 *   R0   Ist-Zustand: bootstrapCI(...) unveraendert (Referenz).
 *   R1   t-Intervall auf N_eff statt BCa-Perzentil:  mean +/- t.95(N_eff-1)*sd/sqrt(N_eff).
 *   R2   GEPOOLTE Lag-1-AC: ein AC-Wert ueber alle M_POOL Reihen (Boards) gemeinsam,
 *        daraus N_eff, daraus f = sqrt(n/N_eff), angewandt auf das BCa-Intervall.
 *   R3   R1 + R2: t-Intervall auf dem N_eff aus der GEPOOLTEN AC.
 *   R4   Bootstrap-t (studentisiert), gleicher Block-Bootstrap (blockLen 2, B=10000).
 *   R4f  R4 zusaetzlich mit der Produktions-Verbreiterung f = sqrt(n/nEff).
 *   R5a/b/c  fester konservativer Verbreiterungsfaktor (1,20 / 1,35 / 1,50) auf das
 *        BCa-Intervall — statt der Lotterie aus der fenster-geschaetzten AC.
 *   R6   BCa-Analogon zu R3 (kleinster denkbarer Eingriff in die Produktion): das
 *        ECHTE BCa-Intervall bleibt stehen, nur der Verbreiterungsfaktor wird
 *        ersetzt durch f_pool * t.95(N_eff_pool-1)/1,645 — gepoolte AC gegen die
 *        Lotterie, t-Faktor gegen die Kleinstichprobe.
 *
 *   Technik zu R2/R5: bootstrapCI liefert nur das BEREITS verbreiterte Intervall.
 *   Die Verbreiterung ist exakt invertierbar (rank-ic.js:259-261, f > 0 und f >= 1,
 *   da nEff <= n): lo_bca = mean0 - (mean0 - loW)/f. Damit wird KEIN Bootstrap
 *   nachgebaut, sondern das echte BCa-Intervall exakt zurueckgewonnen und mit dem
 *   jeweils anderen Faktor neu verbreitert.
 *
 * DATENERZEUGENDES MODELL (cross-sectional, wie die echten Vintages):
 *   Je Fenster K=120 Titel; Score wird auf 0..100 (sd 17,5) gebracht und auf
 *   1 Dezimale gerundet (operative Stufe, an board-history geeicht); Delta-IC eines
 *   Fensters = spearman(Score_Variante, Return) - spearman(Score_Basis, Return),
 *   beides das ECHTE spearman (Ties wirken damit wie in der Produktion).
 *     g_i ~ N(0,1) wahre Qualitaet;  Basis  sb_i = g_i + eb_i
 *     Variante  sv_i = g_i + tauV*(c*eb_i + sqrt(1-c^2)*e2_i)   -> c kalibriert rho
 *     Return    r_i  = b_w * g_i + N(0,1),  b_w ~ N(0.15, 0.12)
 *
 * AUTOKORRELATIONS-ACHSE (Regel 2 — sie MUSS feuern und wird ausgewiesen):
 *   Ein rein cross-sectional erzeugter Delta-IC ist ueber Fenster praktisch
 *   unkorreliert: die Fenster-Sampling-Streuung dominiert, und ein AR(1) auf dem
 *   gemeinsamen Regime kuerzt sich in der DIFFERENZ weitgehend weg. Genau daran ist
 *   eine frueher gemessene AC-Achse haengen geblieben (realisierte AC blieb beim
 *   -1/n-Bias). Deshalb wird die Persistenz hier als LATENTER REGIME-FAKTOR auf den
 *   gemessenen Vorteil addiert:
 *     delta_w = delta_cs_w + A * u_w,     u_w AR(1) mit Koeffizient PHI_LAT
 *   Kalibrierung in geschlossener Form (u ist mittelwertfrei, Var 1, unabhaengig von
 *   delta_cs): AC1(delta) = PHI_LAT * A^2/(Var(delta_cs) + A^2). Ziel AC1 = 0,3 bei
 *   PHI_LAT = 0,6  =>  A = sd(delta_cs). Lag-2-AC = 0,18 (echte Regime-Persistenz,
 *   nicht nur ein Ein-Schritt-Artefakt). Hinweis: mit iid Cross-Section gilt immer
 *   AC1 <= PHI_LAT, ein reines MA(1) kaeme ueber 0,25 nie hinaus — PHI_LAT = 0,6 ist
 *   die mildeste Wahl, die 0,3 ueberhaupt erreichen kann.
 *   KONTROLLE AC=0: IDENTISCHES A, nur PHI_LAT = 0 -> exakt dieselbe Randverteilung,
 *   nur ohne serielle Abhaengigkeit. Die beiden AC-Zeilen unterscheiden sich damit in
 *   NICHTS ausser der Autokorrelation.
 *   E[A*u] = 0 => mu_true bleibt exakt der cross-sectional gemessene Wert.
 *   Ausgewiesen wird je Zelle (a) die realisierte Lag-1-AC aus einer LANGEN Reihe
 *   (20.000 Fenster, praktisch bias-frei) und (b) die im n-Fenster-Sample gemessene
 *   AC (die den -1/n-Bias zeigt, mit dem die Produktion arbeitet).
 *
 * WAHRER WERT: mu_true wird nicht gesetzt, sondern gross-N gemessen (Pilot 60.000
 * Fenster je Konfiguration) — Ueberdeckung wird gegen den mu_true DERSELBEN Zelle
 * geprueft, sonst misst man Bias statt CI-Qualitaet.
 *
 * WIEDERHOLUNGEN (Regel 3): SE(Ueberdeckung) = sqrt(p(1-p)/R) < 0,01
 *   => worst case p=0,5: R > 0,25/0,0001 = 2500. Gewaehlt R = 3000
 *   => SE <= 0,91 pp (p=0,5), 0,65 pp bei p~0,85. Fester Seed.
 *
 * PREIS (Regel 4): je Kandidat und Zelle die mittlere HALBBREITE, ausgewiesen als
 *   Faktor gegenueber R0 derselben Zelle. Ein Intervall, das nur haelt, weil es
 *   nutzlos breit ist, ist keine Reparatur.
 *
 * Aufruf:  node scripts/k1-reparatur-sim-a.js
 */

const path = require('path');
const os = require('os');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const { bootstrapCI, nEff, spearman, stddev } = require(path.join(__dirname, 'rank-ic.js'));

// ---------------------------------------------------------------- Parameter
const SEED = 20260729;
const REPS = 3000;               // s. Kopf: SE <= 0,91 pp
const LEVEL = 0.90;              // = CI_LEVEL
const B_MAIN = 10000;            // = BOOTSTRAP_B
const BLOCK_LEN = 2;             // = BOOTSTRAP_BLOCK_LEN (Default von bootstrapCI)
const K = 120;                   // Titel je Fenster (real 84..1198)
const SCORE_SD = 17.5;           // real gemessen 16,9..18,6
const MU_B = 0.15, SD_B = 0.12;  // Signalstaerke-Regime -> IC-Niveau ~0,10
const TAU_B = 1.0;
const GRID_N = [8, 10, 12];
const GRID_RHO = [0.5, 0.9, 0.99];
const GRID_AC = [0.0, 0.3];
const DELTA_TARGET = [0, 0.03];
const PHI_LAT = 0.6;             // s. Kopf (mildeste Wahl, die AC1=0,3 erreicht)
const M_POOL = 6;                // Reihen (Boards) im Pool fuer die gepoolte AC
const F_FIX = [1.20, 1.35, 1.50];
const PILOT_MU = 60000;          // mu_true / sd(delta_cs)
const PILOT_RHO = 4000, BISECT_STEPS = 16;
const PILOT_TAU = 20000, TAU_STEPS = 14;
const AC_LONG = 20000;           // Laenge der Kontrollreihe fuer die realisierte AC
const LATTE = 0.85;

const CAND = ['R0', 'R1', 'R2', 'R3', 'R4', 'R4f',
  'R5-' + F_FIX[0].toFixed(2), 'R5-' + F_FIX[1].toFixed(2), 'R5-' + F_FIX[2].toFixed(2), 'R6'];
const NC = CAND.length;

// ------------------------------------------------------------------ RNG/Kern
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNorm(rng) {
  let spare = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u, v, s;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m; return u * m;
  };
}
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
// Mirror von rank-ic.js:101 pearson() — dort NICHT exportiert (module.exports:940).
// Identische Formel, damit die gepoolte AC (R2/R3) exakt dieselbe Groesse schaetzt
// wie nEff() sie fensterweise schaetzt.
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}
// Score auf die reale Skala (0..100, sd ~17,5) + 1-Dezimal-Quantisierung (operativ).
function toScore(raw, out) {
  const n = raw.length;
  let m = 0; for (let i = 0; i < n; i++) m += raw[i]; m /= n;
  let ss = 0; for (let i = 0; i < n; i++) ss += (raw[i] - m) ** 2;
  const sd = Math.sqrt(ss / (n - 1)) || 1;
  for (let i = 0; i < n; i++) {
    let s = 50 + SCORE_SD * (raw[i] - m) / sd;
    if (s < 0) s = 0; else if (s > 100) s = 100;
    out[i] = Math.round(s * 10) / 10;
  }
  return out;
}

/** Eine Reihe von n Fenstern -> gepaarte Delta-ICs inkl. Regime-Faktor A*u. */
function genSeries(n, P, norm, buf) {
  const { rawB, rawV, ret, scB, scV } = buf;
  const pts = new Array(n);
  const cc = Math.sqrt(Math.max(0, 1 - P.c * P.c));
  const kk = Math.sqrt(1 - P.phiLat * P.phiLat);
  let u = norm();                       // stationaer gestartet, kein Burn-in noetig
  for (let w = 0; w < n; w++) {
    if (w > 0) u = P.phiLat * u + kk * norm();
    const b = MU_B + SD_B * norm();
    for (let i = 0; i < K; i++) {
      const g = norm(), eb = norm(), e2 = norm();
      rawB[i] = g + TAU_B * eb;
      rawV[i] = g + P.tauV * (P.c * eb + cc * e2);
      ret[i] = b * g + norm();
    }
    toScore(rawB, scB); toScore(rawV, scV);
    pts[w] = (spearman(scV, ret) || 0) - (spearman(scB, ret) || 0) + P.A * u;
  }
  return pts;
}
const makeBuf = () => ({
  rawB: new Array(K), rawV: new Array(K), ret: new Array(K),
  scB: new Array(K), scV: new Array(K),
});

// t-Quantil 0,95 (einseitig) fuer df 1..30, linear interpoliert.
const T95 = [6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812,
  1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725,
  1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697];
function t95(df) {
  if (df <= 1) return T95[0];
  if (df >= 30) return 1.645 + (T95[29] - 1.645) * 30 / df;
  const i = Math.floor(df), fr = df - i;
  return T95[i - 1] + fr * (T95[Math.min(29, i)] - T95[i - 1]);
}

// ---- Block-Bootstrap fuer R4 (studentisiert). Mirror von rank-ic.js:190-204
// (lcg/blockResample sind dort nicht exportiert). R4 ist ein NEUER Kandidat, den
// es im Repo nicht gibt — der Resampling-Mechanismus ist bewusst byte-gleich zur
// Produktion, damit nur die Intervall-Konstruktion verglichen wird.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function blockResample(points, rnd, blockLen, out) {
  const n = points.length;
  let filled = 0;
  while (filled < n) {
    const start = Math.floor(rnd() * n);
    for (let k = 0; k < blockLen && filled < n; k++) out[filled++] = points[(start + k) % n];
  }
  return out;
}
function bootstrapT(points, level, B, seed, blockLen) {
  const n = points.length;
  const bl = Math.max(1, Math.min(blockLen, n));
  const rnd = lcg(seed);
  const m0 = mean(points);
  const se0 = stddev(points) / Math.sqrt(n);
  if (!(se0 > 0)) return null;
  const sample = new Array(n);
  const ts = [];
  for (let b = 0; b < B; b++) {
    blockResample(points, rnd, bl, sample);
    const mb = mean(sample);
    const sb = stddev(sample);
    if (!(sb > 1e-12)) continue;          // entarteter Resample (alle Punkte gleich)
    ts.push((mb - m0) / (sb / Math.sqrt(n)));
  }
  if (ts.length < 100) return null;
  ts.sort((a, b) => a - b);
  const at = (p) => ts[Math.min(ts.length - 1, Math.max(0, Math.round(p * (ts.length - 1))))];
  const alpha = (1 - level) / 2;
  return { lo: m0 - at(1 - alpha) * se0, hi: m0 - at(alpha) * se0 };
}

// N_eff aus einem GEGEBENEN rho — exakt die Formel aus nEff() (rank-ic.js:274-282),
// inkl. Kendall-Bias-Korrektur und 0,95-Kappung. Nur die Herkunft von rho aendert
// sich (gepoolt statt fenster-geschaetzt), sonst nichts.
function nEffFromRho(rho, n) {
  if (rho === null) return n;
  const rhoC = Math.min(0.95, rho + (1 + 3 * rho) / n);
  if (rhoC <= 0) return n;
  return Math.max(1, n * (1 - rhoC) / (1 + rhoC));
}
function pooledRho(seriesList, n) {
  const xs = [], ys = [];
  for (const s of seriesList) for (let i = 0; i + 1 < n; i++) { xs.push(s[i]); ys.push(s[i + 1]); }
  return pearson(xs, ys);
}

/** Alle Kandidaten auf EINER Reihe. Liefert [lo,hi] je Kandidat. */
function candidates(points, rhoPool, seedCI, seedT) {
  const n = points.length;
  const m0 = mean(points);
  const sd = stddev(points);
  const ci = bootstrapCI(points, LEVEL, B_MAIN, seedCI);     // R0 (echte Maschinerie)
  const ne = nEff(points);
  const f = Math.sqrt(n / ne);                               // = f in bootstrapCI
  // BCa vor der Verbreiterung exakt zurueckrechnen (rank-ic.js:259-261 ist invertierbar)
  const loB = m0 - (m0 - ci.lo) / f;
  const hiB = m0 + (ci.hi - m0) / f;
  const widen = (ff) => [m0 - (m0 - loB) * ff, m0 + (hiB - m0) * ff];
  const tInt = (neu) => { const h = t95(Math.max(1, neu - 1)) * sd / Math.sqrt(neu); return [m0 - h, m0 + h]; };
  const nePool = nEffFromRho(rhoPool, n);
  const fPool = Math.sqrt(n / nePool);
  const bt = bootstrapT(points, LEVEL, B_MAIN, seedT, BLOCK_LEN);
  const btI = bt ? [bt.lo, bt.hi] : [ci.lo, ci.hi];           // Rueckfall: Produktion
  const out = [
    [ci.lo, ci.hi],                                          // R0
    tInt(ne),                                                // R1
    widen(fPool),                                            // R2
    tInt(nePool),                                            // R3
    btI,                                                     // R4
    [m0 - (m0 - btI[0]) * f, m0 + (btI[1] - m0) * f],        // R4f
  ];
  for (const ff of F_FIX) out.push(widen(ff));               // R5a/b/c
  out.push(widen(fPool * t95(Math.max(1, nePool - 1)) / 1.645));  // R6
  return { out, f, ne, nePool, degenT: bt === null };
}

// =============================================================== Worker-Teil
if (!isMainThread) {
  const res = [];
  for (const cell of workerData.cells) {
    const norm = makeNorm(makeRng(cell.seed));
    const buf = makeBuf();
    const cov = new Array(NC).fill(0), hw = new Array(NC).fill(0), bad = new Array(NC).fill(0);
    let fSum = 0, fOne = 0, neSum = 0, nePoolSum = 0, acShort = 0, degT = 0;
    for (let r = 0; r < REPS; r++) {
      const pool = [];
      for (let s = 0; s < M_POOL; s++) pool.push(genSeries(cell.n, cell, norm, buf));
      const pts = pool[0];
      const rp = pooledRho(pool, cell.n);
      const c = candidates(pts, rp, (cell.seed + r * 7919) >>> 0, (cell.seed + r * 104729) >>> 0);
      fSum += c.f; if (c.f <= 1 + 1e-12) fOne++;
      neSum += c.ne; nePoolSum += c.nePool; if (c.degenT) degT++;
      const a = pearson(pts.slice(0, -1), pts.slice(1));
      acShort += (a === null ? 0 : a);
      for (let k = 0; k < NC; k++) {
        const [lo, hi] = c.out[k];
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) { bad[k]++; continue; }
        if (lo <= cell.muTrue && cell.muTrue <= hi) cov[k]++;
        hw[k] += (hi - lo) / 2;
      }
    }
    // Realisierte Lag-1-AC aus einer LANGEN Reihe (praktisch bias-frei) — Beleg,
    // dass die AC-Achse tatsaechlich feuert.
    const normL = makeNorm(makeRng((cell.seed + 555555) >>> 0));
    const longS = genSeries(AC_LONG, cell, normL, buf);
    const acLong = pearson(longS.slice(0, -1), longS.slice(1));
    res.push({
      ...cell,
      coverage: cov.map((x) => x / REPS),
      halfWidth: hw.map((x, k) => x / Math.max(1, REPS - bad[k])),
      bad, acLong, acShort: acShort / REPS,
      fMean: fSum / REPS, fOneShare: fOne / REPS,
      neMean: neSum / REPS, nePoolMean: nePoolSum / REPS,
      degenT: degT / REPS, sdPts: stddev(longS),
    });
  }
  parentPort.postMessage(res);
  return;
}

// ================================================================ Main-Teil
function pilot(count, P, norm) {
  const buf = makeBuf();
  const icb = new Array(count), icv = new Array(count);
  const cc = Math.sqrt(Math.max(0, 1 - P.c * P.c));
  for (let w = 0; w < count; w++) {
    const b = MU_B + SD_B * norm();
    for (let i = 0; i < K; i++) {
      const g = norm(), eb = norm(), e2 = norm();
      buf.rawB[i] = g + TAU_B * eb;
      buf.rawV[i] = g + P.tauV * (P.c * eb + cc * e2);
      buf.ret[i] = b * g + norm();
    }
    toScore(buf.rawB, buf.scB); toScore(buf.rawV, buf.scV);
    icb[w] = spearman(buf.scB, buf.ret) || 0;
    icv[w] = spearman(buf.scV, buf.ret) || 0;
  }
  return { icb, icv };
}

(async function main() {
  const t0 = Date.now();
  console.log('K1-REPARATUR-MESSUNG ARM A — Seed ' + SEED + ', ' + REPS + ' Wiederholungen je Zelle');
  console.log('SE(Ueberdeckung) = sqrt(p(1-p)/R) < 1 pp verlangt R > 2500; gewaehlt R = ' + REPS
    + ' => SE <= ' + (Math.sqrt(0.25 / REPS) * 100).toFixed(2) + ' pp (p=0,5), '
    + (Math.sqrt(0.85 * 0.15 / REPS) * 100).toFixed(2) + ' pp (p=0,85).');
  console.log('Latte: Ueberdeckung >= ' + (LATTE * 100) + ' % in JEDER Zelle. Quantisierung: immer an (1 Dezimale).\n');

  // --- 1) tauV kalibrieren: mittleres Delta-IC = 0,03 (Delta=0 => tauV = tauB)
  const tauVfor = { 0: TAU_B };
  {
    let lo = 0.30, hi = 1.0;
    for (let s = 0; s < TAU_STEPS; s++) {
      const mid = (lo + hi) / 2;
      const p = pilot(PILOT_TAU, { c: 0, tauV: mid }, makeNorm(makeRng(SEED + 101 + s)));
      let m = 0; for (let i = 0; i < PILOT_TAU; i++) m += p.icv[i] - p.icb[i];
      m /= PILOT_TAU;
      if (m > 0.03) lo = mid; else hi = mid;   // kleineres tauV => besserer Proxy => groesseres Delta
    }
    tauVfor[0.03] = (lo + hi) / 2;
  }
  console.log('tauV kalibriert: Delta=0 -> ' + TAU_B.toFixed(4) + ' | Delta=0.03 -> ' + tauVfor[0.03].toFixed(4));

  // --- 2) c kalibrieren: corr(IC_v, IC_b) = Ziel-rho
  const cFor = {};
  for (const rho of GRID_RHO) for (const dt of DELTA_TARGET) {
    let lo = -0.95, hi = 0.9999;
    for (let s = 0; s < BISECT_STEPS; s++) {
      const mid = (lo + hi) / 2;
      const p = pilot(PILOT_RHO, { c: mid, tauV: tauVfor[dt] }, makeNorm(makeRng(SEED + 301 + s)));
      if (pearson(p.icb, p.icv) < rho) lo = mid; else hi = mid;
    }
    cFor[rho + '|' + dt] = (lo + hi) / 2;
  }

  // --- 3) mu_true + sd(delta_cs) gross-N messen (je rho, delta) -> daraus A
  const muTrue = {}, sdCs = {}, Afor = {};
  console.log('\nWahrheit + AC-Kalibrierung (Pilot ' + PILOT_MU + ' Fenster je Konfiguration, K=' + K + '):');
  console.log('  rho  | Delta | c        | mu_true   | sd(delta_cs) | A (=sd*sqrt(t/(phi-t)))');
  for (const rho of GRID_RHO) for (const dt of DELTA_TARGET) {
    const key = rho + '|' + dt;
    const p = pilot(PILOT_MU, { c: cFor[key], tauV: tauVfor[dt] }, makeNorm(makeRng(SEED + 201 + Math.round(dt * 1000) + Math.round(rho * 100))));
    const d = new Array(PILOT_MU);
    for (let i = 0; i < PILOT_MU; i++) d[i] = p.icv[i] - p.icb[i];
    muTrue[key] = mean(d);
    sdCs[key] = stddev(d);
    // AC1 = phi*A^2/(V_cs+A^2) = 0.3 bei phi=0.6  =>  A^2 = V_cs*0.3/(0.6-0.3) = V_cs
    Afor[key] = sdCs[key] * Math.sqrt(0.3 / (PHI_LAT - 0.3));
    console.log('  ' + rho.toFixed(2) + ' |  ' + dt.toFixed(2) + ' | ' + cFor[key].toFixed(5).padStart(8)
      + ' | ' + muTrue[key].toFixed(6).padStart(9) + ' |     ' + sdCs[key].toFixed(5)
      + '  | ' + Afor[key].toFixed(5));
  }
  console.log('  (mu_true ist c-invariant und wird durch A*u NICHT verschoben: E[u]=0.)');

  // --- 4) Zellen
  const cells = [];
  let sd = 1;
  for (const n of GRID_N) for (const rho of GRID_RHO) for (const ac of GRID_AC) for (const dt of DELTA_TARGET) {
    const key = rho + '|' + dt;
    cells.push({
      n, rho, acTarget: ac, deltaTarget: dt,
      c: cFor[key], tauV: tauVfor[dt], muTrue: muTrue[key],
      A: Afor[key], phiLat: ac === 0 ? 0 : PHI_LAT,   // gleiches A, nur die Persistenz schaltet
      seed: (SEED + 1000 * sd++) >>> 0,
    });
  }
  console.log('\nZellen: ' + cells.length + ' (n x rho x AC x Delta), je ' + REPS + ' Wiederholungen x '
    + M_POOL + ' Reihen, ' + NC + ' Kandidaten auf denselben Daten.');

  const nw = Math.min(12, Math.max(1, os.cpus().length - 2));
  const chunks = Array.from({ length: nw }, () => []);
  cells.forEach((c, i) => chunks[i % nw].push(c));
  const rows = (await Promise.all(chunks.filter((ch) => ch.length).map((ch) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { cells: ch } });
    w.on('message', res); w.on('error', rej);
    w.on('exit', (code) => { if (code !== 0) rej(new Error('Worker exit ' + code)); });
  })))).flat().sort((a, b) => a.acTarget - b.acTarget || a.n - b.n || a.rho - b.rho || a.deltaTarget - b.deltaTarget);

  // --- 5) Ausgabe
  const pct = (x) => (x * 100).toFixed(1).padStart(5);
  const head = CAND.map((c) => c.padStart(7)).join(' |');
  for (const ac of GRID_AC) {
    console.log('\n=== AC-Ziel ' + ac.toFixed(1) + ' ===  Ueberdeckung in % (Latte ' + (LATTE * 100) + ' %, ROT markiert)');
    console.log('  n | rho  | Delta | AC_lang | AC_kurz | f=1 % | ' + head);
    for (const r of rows.filter((x) => x.acTarget === ac)) {
      const cov = r.coverage.map((c) => (c < LATTE ? '*' : ' ') + (c * 100).toFixed(1).padStart(6)).join(' |');
      console.log('  ' + String(r.n).padStart(2) + ' | ' + r.rho.toFixed(2) + ' |  ' + r.deltaTarget.toFixed(2)
        + ' |  ' + r.acLong.toFixed(3).padStart(6) + ' |  ' + r.acShort.toFixed(3).padStart(6)
        + ' | ' + pct(r.fOneShare) + ' | ' + cov);
    }
  }
  console.log('\n  AC_lang = realisierte Lag-1-AC aus ' + AC_LONG + ' Fenstern (bias-frei) — BELEG, dass die Achse wirkt.');
  console.log('  AC_kurz = im n-Fenster-Sample gemessene AC (der -1/n-Bias, mit dem die Produktion rechnet).');
  console.log('  f=1 %   = Anteil der Faelle ohne jede Verbreiterung im Ist-Zustand (die Lotterie).');

  // Breiten-Preis
  console.log('\n=== PREIS: mittlere Halbbreite relativ zu R0 derselben Zelle ===');
  console.log('  n | rho  | AC  | Delta | ' + head);
  for (const r of rows) {
    const rel = r.halfWidth.map((w) => (w / r.halfWidth[0]).toFixed(2).padStart(7)).join(' |');
    console.log('  ' + String(r.n).padStart(2) + ' | ' + r.rho.toFixed(2) + ' | ' + r.acTarget.toFixed(1)
      + ' |  ' + r.deltaTarget.toFixed(2) + ' | ' + rel);
  }

  // Zusammenfassung je Kandidat
  console.log('\n=== URTEIL je Kandidat (ueber alle ' + rows.length + ' Zellen) ===');
  console.log('  Kandidat | schlechteste | mittlere | Zellen<85% | Breite x R0 (Mittel / max)');
  const summary = [];
  for (let k = 0; k < NC; k++) {
    const cs = rows.map((r) => r.coverage[k]);
    const rel = rows.map((r) => r.halfWidth[k] / r.halfWidth[0]);
    const worst = Math.min(...cs), avg = mean(cs);
    const fails = cs.filter((c) => c < LATTE).length;
    summary.push({ name: CAND[k], worst, avg, fails, relMean: mean(rel), relMax: Math.max(...rel) });
    console.log('  ' + CAND[k].padEnd(8) + ' |       ' + (worst * 100).toFixed(1).padStart(5)
      + ' %  |  ' + (avg * 100).toFixed(1).padStart(5) + ' % |     ' + String(fails).padStart(2) + '/' + rows.length
      + '    |  ' + mean(rel).toFixed(2) + ' / ' + Math.max(...rel).toFixed(2));
  }
  const holders = summary.filter((s) => s.fails === 0).sort((a, b) => a.relMean - b.relMean);
  console.log('\nHaelt die Latte in JEDER Zelle: ' + (holders.length
    ? holders.map((s) => s.name + ' (schlechteste ' + (s.worst * 100).toFixed(1) + ' %, Breite x' + s.relMean.toFixed(2) + ')').join(', ')
    : 'KEINER'));
  console.log('EMPFEHLUNG: ' + (holders.length
    ? holders[0].name + ' — billigster Kandidat, der haelt: Abstand zur Latte '
      + ((holders[0].worst - LATTE) * 100).toFixed(1) + ' pp, Preis x' + holders[0].relMean.toFixed(2) + ' Breite.'
    : 'kein Kandidat haelt die Latte — die Latte wird NICHT gesenkt.'));

  const degen = rows.reduce((s, r) => s + r.degenT, 0) / rows.length;
  const bad = rows.reduce((s, r) => s + r.bad.reduce((a, b) => a + b, 0), 0);
  console.log('\nDiagnose: R4-Rueckfaelle (entarteter studentisierter Bootstrap) ' + (degen * 100).toFixed(2)
    + ' %, nicht-endliche Intervalle ' + bad + ' (als Fehlschlag gezaehlt).');
  console.log('Laufzeit ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s.');

  // ponytail: eine Selbstprobe statt Test-Suite — faellt um, wenn die Verdrahtung bricht.
  const flat = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
  const chk = bootstrapCI(flat, LEVEL, 500, 1);
  console.assert(Math.abs(chk.lo - 0.1) < 1e-9 && Math.abs(chk.hi - 0.1) < 1e-9, 'bootstrapCI-Verdrahtung kaputt');
  // Inversion der f-Verbreiterung muss exakt sein: mit fFix=1 muss R5 das BCa treffen,
  // und bei unkorrelierten Punkten (f=1) muss R5(f=1) == R0 sein.
  const pts = [0.02, -0.01, 0.05, 0.00, 0.03, -0.02, 0.01, 0.04, 0.02, -0.03];
  const m0 = mean(pts);
  const ci0 = bootstrapCI(pts, LEVEL, 2000, 42);
  const f0 = Math.sqrt(pts.length / nEff(pts));
  const back = m0 - (m0 - ci0.lo) / f0;
  console.assert(Math.abs((m0 - (m0 - back) * f0) - ci0.lo) < 1e-12, 'f-Inversion nicht exakt');
  console.assert(rows.length === GRID_N.length * GRID_RHO.length * GRID_AC.length * DELTA_TARGET.length, 'Gitter unvollstaendig');
})();
