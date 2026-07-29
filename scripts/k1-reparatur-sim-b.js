#!/usr/bin/env node
'use strict';
/**
 * scripts/k1-reparatur-sim-b.js — K1-REPARATUR-MESSUNG (ARM B). Reine Messung.
 * Schreibt nichts, aendert nichts, committet nichts. rank-ic.js bleibt unangetastet.
 *
 * FRAGE: Das produktive 90-%-CI (rank-ic.js:bootstrapCI) haelt bei n = 8..12
 * Messfenstern real nur 75-84 %. Welche Reparatur haelt die Latte >= 85 % —
 * und was kostet sie an Intervallbreite?
 *
 * URSACHE (vorgemessen, hier nur nachgewiesen): der Verbreiterungsfaktor
 * f = sqrt(n/N_eff) haengt an einer Lag-1-Autokorrelation, die aus DENSELBEN
 * 8-12 Punkten geschaetzt wird. nEff() gibt n zurueck, sobald die korrigierte
 * Schaetzung <= 0 ausfaellt -> in ueber der Haelfte der Faelle f = 1 (Lotterie).
 *
 * KANDIDATEN
 *   R0   Ist-Zustand: bootstrapCI() unveraendert (BCa + f aus DIESER Reihe)
 *   R1   t-Intervall auf N_eff:  mean +/- t(N_eff-1) * sd/sqrt(N_eff)
 *   R2   BCa wie R0, aber f aus GEPOOLTER Lag-1-AC (ein AC-Wert ueber alle
 *        Boards der Familie gemeinsam) statt aus der Einzelreihe
 *   R3   R1 + R2 (t-Intervall, N_eff aus gepoolter AC)
 *   R4   Bootstrap-t (studentisiert, Block-Resampling) statt Perzentil/BCa
 *   R5a  fester Verbreiterungsfaktor 1,30 auf das BCa (keine Schaetzung)
 *   R5b  fester Verbreiterungsfaktor 1,50
 *
 * ECHTE MASCHINERIE (nichts davon nachgebaut):
 *   bootstrapCI(points, level, B, seed, blockLen) -> {lo, hi, p}   (rank-ic.js:239)
 *   nEff(points) -> N_eff                                          (rank-ic.js:274)
 *   spearman(xs, ys) -> IC (Durchschnittsraenge bei Ties)          (rank-ic.js:110)
 *   stddev(values) -> Stichproben-SD (n-1)                         (rank-ic.js:111)
 *   invNormalCdf(p)  — hier zusaetzlich als Normal-Generator genutzt
 *   Konstanten uebernommen: CI_LEVEL 0.90, BOOTSTRAP_BLOCK_LEN 2.
 *
 * WIE R2/R5 an das UNVERBREITERTE BCa kommen: bootstrapCI() liefert bereits das
 * verbreiterte Intervall. rank-ic.js:259-261 rechnet
 *     loW = mean0 - (mean0-lo)*f,  hiW = mean0 + (hi-mean0)*f,  f = sqrt(n/nEff(points))
 * Beide Groessen sind hier verfuegbar (mean0 aus points, f ueber das exportierte
 * nEff), also wird das rohe BCa exakt zurueckgerechnet und mit einem ANDEREN
 * Faktor neu verbreitert. Kein zweiter Bootstrap noetig, kein Nachbau des BCa.
 * Der Selbstcheck prueft die Rueckrechnung numerisch.
 *
 * DATENERZEUGENDES MODELL (bewusst anders gebaut als die Coverage-Simulationen;
 * zwei identisch gebaute Simulationen beweisen nichts):
 *   - Querschnitt je Fenster: M Titel, Score-SD so skaliert, dass die
 *     Bindungsdichte (Zeilen je 0,1-Score-Bin) dem Median-Board entspricht;
 *     der IC entsteht durch den ECHTEN spearman() auf 1-dezimal gerundeten
 *     Scores (nur der quantisierte, operative Fall wird gemessen).
 *   - Variante teilt ihr Score-Rauschen ANTEILIG mit der Basis (Gewicht psi)
 *     — kein separater "shared"-Vektor; psi wird per Bisektion auf das
 *     Ziel-rho = corr(IC_Basis, IC_Variante) kalibriert.
 *   - Autokorrelation: alle vier latenten Vektoren folgen einem AR(1) ueber die
 *     Fenster (Koeffizient phi, stationaer initialisiert). phi wird per
 *     Bisektion auf die ZIEL-Lag-1-AC der Delta-Reihe kalibriert, gemessen an
 *     einer langen Pilotreihe. Ein harter Selbstcheck bricht ab, wenn die
 *     realisierte AC das Ziel um mehr als 0,03 verfehlt — genau der Fehler,
 *     an dem ein frueherer Arm gescheitert ist (AC-Achse feuerte nie).
 *   - FAMILIE: K Boards laufen parallel; sie teilen den Anteil KAPPA ihrer
 *     Schocks (gleiche Marktphase, verschiedene Kohorten). Nur daraus kann R2
 *     seine gepoolte AC schaetzen — die Boards sind NICHT unabhaengig, sonst
 *     waere R2 kuenstlich bevorteilt. Die realisierte Board-zu-Board-Korrelation
 *     der Delta-Reihen wird ausgewiesen.
 *
 * WAHRHEIT: das wahre mittlere Delta-IC wird nicht gesetzt, sondern an einer
 * langen Pilotreihe gemessen (PILOT_WINDOWS). Ueberdeckt wird gegen diesen Wert.
 *
 * WIEDERHOLUNGEN: SE(p) = sqrt(p(1-p)/R). Gefordert < 1 pp = 0,01:
 *   worst case p = 0,5 -> R > 0,25/0,0001 = 2500. R = 2500 => SE <= 1,00 pp,
 *   bei p = 0,85 nur 0,71 pp, bei p = 0,90 nur 0,60 pp. Fester Seed.
 *
 * Aufruf:  node scripts/k1-reparatur-sim-b.js [--reps 2500] [--B 2000] [--probe]
 */

const path = require('path');
const { bootstrapCI, nEff, spearman, stddev, invNormalCdf } = require(path.join(__dirname, 'rank-ic.js'));

// ── Parameter ────────────────────────────────────────────────────────────────
const SEED = 20260729;
const LEVEL = 0.90;             // = CI_LEVEL in rank-ic.js
const BLOCK = 2;                // = BOOTSTRAP_BLOCK_LEN in rank-ic.js
const BAR = 85;                 // Latte in Prozent — wird nicht gesenkt
const M = 80;                   // Titel je Fenster (Laufzeit; SCORE_SD mitskaliert)
const SCORE_SD = 17.5 * M / 341; // haelt die Bindungsdichte des Median-Boards (0,78 Zeilen/0,1-Bin)
const S_BASE = 0.11;            // Signalladung Basis  -> Basis-IC ~0,105
const SIGMA_R = 0.30;           // Return-Rauschen
// K1B_K/K1B_RHO/K1B_AC: nur fuer Sensitivitaets-Nachlaeufe (z. B. "haelt R3 auch,
// wenn die Familie statt 9 nur 3 Boards zum Poolen hat?"). Default = Hauptlauf.
const KBOARDS = Number(process.env.K1B_K) || 9;   // Boards je Familie (Pooling fuer R2/R3)
const KAPPA = 0.5;              // Anteil gemeinsamer Schocks zwischen Boards
const numList = (env, def) => (process.env[env] ? process.env[env].split(',').map(Number) : def);
const RHO_GRID = numList('K1B_RHO', [0.5, 0.9, 0.99]);
const AC_GRID = numList('K1B_AC', [0.0, 0.3]);
const N_GRID = [8, 10, 12];
const DELTA_GRID = [0, 0.03];
const FIXED_F = [1.30, 1.50];   // R5a / R5b
const PILOT_WINDOWS = 20000;    // "Wahrheit" + realisierte rho/AC
const CROSS_WINDOWS = 2000;     // realisierte Board-zu-Board-Korrelation
const CAL_WINDOWS = 1500;       // Bisektion
const AC_TOL = 0.03;            // harte Kalibrierungs-Toleranz

const CAND = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5a', 'R5b'];

// ── RNG: sfc32 (nicht mulberry32) + Normale via invNormalCdf (echte Maschinerie) ─
function makeRng(seed) {
  let a = (seed ^ 0x9e3779b9) >>> 0, b = (seed + 0x85ebca6b) >>> 0,
      c = (seed ^ 0xc2b2ae35) >>> 0, d = 1;
  const u01 = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return ((t >>> 0) + 0.5) / 4294967296;   // strikt in (0,1)
  };
  for (let i = 0; i < 12; i++) u01();
  return { u01, normal: () => invNormalCdf(u01()) };
}

// ── Fenster-Kette: K Boards, 4 Latente je Board, AR(1) mit gemeinsamem Anteil ──
function makeChains(nBoards, phi, rng) {
  const kk = Math.sqrt(1 - phi * phi);
  const sk = Math.sqrt(KAPPA), si = Math.sqrt(1 - KAPPA);
  const boards = [];
  for (let b = 0; b < nBoards; b++) {
    const arr = []; for (let a = 0; a < 4; a++) arr.push(new Float64Array(M));
    boards.push(arr);
  }
  const com = []; for (let a = 0; a < 4; a++) com.push(new Float64Array(M));
  const fresh = () => {
    for (let a = 0; a < 4; a++) { const c = com[a]; for (let i = 0; i < M; i++) c[i] = rng.normal(); }
    for (const bd of boards) for (let a = 0; a < 4; a++) {
      const x = bd[a], c = com[a];
      for (let i = 0; i < M; i++) x[i] = sk * c[i] + si * rng.normal();
    }
  };
  fresh();                                   // stationaere Initialisierung
  return {
    boards,
    step() {
      if (phi === 0) { fresh(); return; }
      for (let a = 0; a < 4; a++) { const c = com[a]; for (let i = 0; i < M; i++) c[i] = rng.normal(); }
      for (const bd of boards) for (let a = 0; a < 4; a++) {
        const x = bd[a], c = com[a];
        for (let i = 0; i < M; i++) x[i] = phi * x[i] + kk * (sk * c[i] + si * rng.normal());
      }
    },
  };
}

const q1 = (x) => Math.round((x < 0 ? 0 : x > 100 ? 100 : x) * 10) / 10;

// Ein Board-Fenster -> {icB, icV} ueber den ECHTEN spearman() auf gerundeten Scores.
function boardICs(bd, cfg) {
  const u = bd[0], eta = bd[1], bn = bd[2], vn = bd[3];
  const s = cfg.s, sv = cfg.sv, psi = cfg.psi;
  const wb = Math.sqrt(1 - s * s), wv = Math.sqrt(1 - sv * sv);
  const p1 = Math.sqrt(psi), p2 = Math.sqrt(1 - psi);
  const R = new Array(M), SB = new Array(M), SV = new Array(M);
  for (let i = 0; i < M; i++) {
    R[i] = u[i] + SIGMA_R * eta[i];
    SB[i] = q1(50 + SCORE_SD * (s * u[i] + wb * bn[i]));
    SV[i] = q1(50 + SCORE_SD * (sv * u[i] + wv * (p1 * bn[i] + p2 * vn[i])));
  }
  const a = spearman(SB, R), b = spearman(SV, R);
  return { icB: a === null ? 0 : a, icV: b === null ? 0 : b, sq: SB };
}

function tieShare(vals) {
  const c = new Map(); for (const v of vals) c.set(v, (c.get(v) || 0) + 1);
  let t = 0; for (const k of c.values()) if (k > 1) t += k;
  return t / vals.length;
}

// ── kleine Statistik (lokal, aber gegen die echte Maschinerie geprueft) ───────
const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
function pearsonL(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const p = xs[i] - mx, q = ys[i] - my; num += p * q; dx += p * p; dy += q * q; }
  return (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
}
const lag1 = (a) => (a.length < 3 ? 0 : pearsonL(a.slice(0, -1), a.slice(1)));

// N_eff-Formel exakt wie rank-ic.js:274-282, aber allokationsfrei (Heissschleife).
// Der Selbstcheck erzwingt Gleichheit mit dem ECHTEN nEff().
function nEffFast(a) {
  const n = a.length;
  if (n < 3) return n;
  let mx = 0, my = 0;
  for (let i = 0; i < n - 1; i++) { mx += a[i]; my += a[i + 1]; }
  mx /= (n - 1); my /= (n - 1);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n - 1; i++) { const p = a[i] - mx, q = a[i + 1] - my; num += p * q; dx += p * p; dy += q * q; }
  if (dx === 0 || dy === 0) return n;
  const rho = num / Math.sqrt(dx * dy);
  const rhoC = Math.min(0.95, rho + (1 + 3 * rho) / n);
  if (rhoC <= 0) return n;
  return Math.max(1, n * (1 - rhoC) / (1 + rhoC));
}
// R2/R3: EIN AC-Wert ueber alle Boards der Familie. Jede Reihe wird mit ihrem
// eigenen Mittel zentriert (Boards haben verschiedene Delta-Niveaus), danach
// werden die Lag-1-Paare gepoolt. Bias-Korrektur und Klemmung wie in nEff() —
// Pooling senkt die VARIANZ der Schaetzung, nicht ihren Kleinstichproben-Bias.
function pooledNeff(series, n) {
  if (n < 3) return n;
  let num = 0, dx = 0, dy = 0;
  for (const s of series) {
    let mx = 0, my = 0;
    for (let i = 0; i < n - 1; i++) { mx += s[i]; my += s[i + 1]; }
    mx /= (n - 1); my /= (n - 1);
    for (let i = 0; i < n - 1; i++) { const p = s[i] - mx, q = s[i + 1] - my; num += p * q; dx += p * p; dy += q * q; }
  }
  if (dx === 0 || dy === 0) return n;
  const rho = num / Math.sqrt(dx * dy);
  const rhoC = Math.min(0.95, rho + (1 + 3 * rho) / n);
  if (rhoC <= 0) return n;
  return Math.max(1, n * (1 - rhoC) / (1 + rhoC));
}

// ── Student-t-Quantil (fuer R1/R3; df darf gebrochen sein) ───────────────────
function lgamma(x) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {           // Lentz, Numerical Recipes
  const FPMIN = 1e-300, EPS = 3e-14;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(a, b, x) {            // regularisiertes I_x(a,b)
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbt);
  return (x < (a + 1) / (a + b + 2)) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function tCdf(t, df) {
  const x = df / (df + t * t);
  const p = 0.5 * ibeta(df / 2, 0.5, x);
  return t > 0 ? 1 - p : p;
}
function tQuantile(p, df) {          // Bisektion, df > 0 (auch gebrochen)
  let lo = 0, hi = 400;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Kandidaten ───────────────────────────────────────────────────────────────
const halfOf = (ci) => (ci ? (ci[1] - ci[0]) / 2 : null);

// R4: Block-Bootstrap-t. Studentisiert mit derselben SE-Definition, die auch die
// Reparatur R1 benutzt (sd/sqrt(N_eff)) — genau darum geht es: die Zufaelligkeit
// von N_eff soll durch die Studentisierung absorbiert statt vererbt werden.
function seOf(a) { const n = a.length; const m = mean(a); let ss = 0; for (let i = 0; i < n; i++) ss += (a[i] - m) ** 2; const sd = Math.sqrt(ss / (n - 1)); return sd / Math.sqrt(nEffFast(a)); }
function bootTci(points, B, rng) {
  const n = points.length;
  const m0 = mean(points), se0 = seOf(points);
  if (!(se0 > 0) || !Number.isFinite(se0)) return null;
  const ts = new Float64Array(B);
  const samp = new Float64Array(n);
  for (let b = 0; b < B; b++) {
    let filled = 0;
    while (filled < n) {
      const st = Math.floor(rng.u01() * n);
      for (let k = 0; k < BLOCK && filled < n; k++) samp[filled++] = points[(st + k) % n];
    }
    const sb = seOf(samp);
    ts[b] = (sb > 0 && Number.isFinite(sb)) ? (mean(samp) - m0) / sb : 0;
  }
  ts.sort();
  const at = (p) => ts[Math.min(B - 1, Math.max(0, Math.round(p * (B - 1))))];
  const al = (1 - LEVEL) / 2;
  return [m0 - at(1 - al) * se0, m0 - at(al) * se0];
}

function allCandidates(points, family, B, seed, rng) {
  const n = points.length;
  const m0 = mean(points);
  const ci = bootstrapCI(points, LEVEL, B, seed, BLOCK);     // ECHT
  const ne = nEff(points);                                   // ECHT
  const f0 = Math.sqrt(n / ne);
  // Rueckrechnung auf das unverbreiterte BCa (rank-ic.js:259-261)
  const rawLo = m0 - (m0 - ci.lo) / f0;
  const rawHi = m0 + (ci.hi - m0) / f0;
  const widen = (f) => [m0 - (m0 - rawLo) * f, m0 + (rawHi - m0) * f];
  const neP = pooledNeff(family, n);
  const f2 = Math.sqrt(n / neP);
  const sd = stddev(points);                                 // ECHT
  const tInt = (neff) => {
    const df = Math.max(1, neff - 1);
    const h = tQuantile(1 - (1 - LEVEL) / 2, df) * sd / Math.sqrt(neff);
    return [m0 - h, m0 + h];
  };
  return {
    cis: {
      R0: [ci.lo, ci.hi],
      R1: tInt(ne),
      R2: widen(f2),
      R3: tInt(neP),
      R4: bootTci(points, B, rng),
      R5a: widen(FIXED_F[0]),
      R5b: widen(FIXED_F[1]),
    },
    f0, f2, ne, neP,
  };
}

// ── Pilot / Kalibrierung ─────────────────────────────────────────────────────
function runSeries(cfg, phi, windows, seed, nBoards) {
  const rng = makeRng(seed);
  const ch = makeChains(nBoards, phi, rng);
  const icB = new Float64Array(windows), icV = new Float64Array(windows);
  const series = []; for (let k = 0; k < nBoards; k++) series.push(new Float64Array(windows));
  let ties = 0, tieN = 0;
  for (let t = 0; t < windows; t++) {
    if (t > 0) ch.step();
    for (let k = 0; k < nBoards; k++) {
      const w = boardICs(ch.boards[k], cfg);
      series[k][t] = w.icV - w.icB;
      if (k === 0) {
        icB[t] = w.icB; icV[t] = w.icV;
        if (t % 100 === 0) { ties += tieShare(w.sq); tieN++; }
      }
    }
  }
  const d0 = series[0];
  let cross = null;
  if (nBoards > 1) {
    let s = 0, c = 0;
    for (let i = 0; i < nBoards; i++) for (let j = i + 1; j < nBoards; j++) { s += pearsonL(series[i], series[j]); c++; }
    cross = s / c;
  }
  const md = mean(d0);
  let ss = 0; for (let i = 0; i < windows; i++) ss += (d0[i] - md) ** 2;
  return {
    rho: pearsonL(icB, icV), ac: lag1(d0), meanD: md, sdD: Math.sqrt(ss / (windows - 1)),
    meanIcB: mean(icB), cross, ties: tieN ? ties / tieN : 0,
  };
}
function calibratePsi(rhoTarget, sv, seed) {
  let lo = 0, hi = 1, mid = 0.5;
  for (let i = 0; i < 12; i++) {
    mid = (lo + hi) / 2;
    const r = runSeries({ s: S_BASE, sv, psi: mid }, 0, CAL_WINDOWS, seed, 1).rho;
    if (r < rhoTarget) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
// phi wird gegen DIESELBE lange Pilotreihe bisektiert, die anschliessend die
// Wahrheit liefert (gleicher Seed, gleiche Laenge, Common Random Numbers).
// Grund: eine kurze Kalibrierreihe und eine separate Pilotreihe streuen jeweils
// um ~0,02 in der AC — die Differenz sprengte die 0,03-Toleranz, ohne dass die
// Mechanik falsch war. So ist die ausgewiesene realisierte AC exakt die, gegen
// die kalibriert wurde. Rueckgabe: {phi, pilot}.
function calibratePhi(acTarget, cfg, seed, windows) {
  if (acTarget === 0) return { phi: 0, pilot: runSeries(cfg, 0, windows, seed, 1) };
  let lo = 0, hi = 0.98, mid = 0.5, last = null;
  for (let i = 0; i < 10; i++) {
    mid = (lo + hi) / 2;
    last = runSeries(cfg, mid, windows, seed, 1);
    if (last.ac < acTarget) lo = mid; else hi = mid;
  }
  const phi = (lo + hi) / 2;
  return { phi, pilot: runSeries(cfg, phi, windows, seed, 1) };
}

// ── Selbstcheck: faellt laut aus, wenn eine Annahme nicht traegt ─────────────
function selfCheck() {
  const ok = (c, m) => { if (!c) throw new Error('SELFCHECK: ' + m); };
  ok(Math.abs(spearman([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8]) - 1) < 1e-12, 'spearman kaputt');
  // t-Quantile gegen Tabellenwerte
  ok(Math.abs(tQuantile(0.95, 1) - 6.313752) < 1e-4, 't(0.95,1)');
  ok(Math.abs(tQuantile(0.95, 10) - 1.812461) < 1e-4, 't(0.95,10)');
  ok(Math.abs(tQuantile(0.95, 30) - 1.697261) < 1e-4, 't(0.95,30)');
  ok(Math.abs(tQuantile(0.95, 1e7) - 1.644854) < 1e-4, 't(0.95,inf)');
  // nEffFast MUSS dem echten nEff entsprechen (sonst misst R4 etwas anderes)
  const rng = makeRng(7);
  for (let k = 0; k < 200; k++) {
    const n = 8 + (k % 5);
    const a = []; let prev = 0;
    for (let i = 0; i < n; i++) { prev = 0.6 * prev + rng.normal(); a.push(prev * 0.02 + 0.01); }
    const x = nEff(a), y = nEffFast(a);
    ok(Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x)), `nEffFast != nEff (${x} vs ${y})`);
  }
  // bootstrapCI: reproduzierbar, enthaelt das Stichprobenmittel, f >= 1
  const pts = [0.01, 0.04, 0.02, 0.05, 0.00, 0.03, 0.06, 0.02, 0.01, 0.04];
  const c1 = bootstrapCI(pts, LEVEL, 1500, 42, BLOCK), c2 = bootstrapCI(pts, LEVEL, 1500, 42, BLOCK);
  ok(c1.lo === c2.lo && c1.hi === c2.hi, 'bootstrapCI nicht reproduzierbar');
  const m0 = mean(pts);
  ok(c1.lo < m0 && m0 < c1.hi, 'CI enthaelt sein eigenes Mittel nicht');
  const f0 = Math.sqrt(pts.length / nEff(pts));
  ok(f0 >= 1 - 1e-12, 'f < 1 — Rueckrechnung waere unzulaessig');
  // Rueckrechnung auf das rohe BCa und zurueck (faengt Vorzeichen-/Tippfehler)
  const rawLo = m0 - (m0 - c1.lo) / f0, rawHi = m0 + (c1.hi - m0) / f0;
  ok(Math.abs((m0 - (m0 - rawLo) * f0) - c1.lo) < 1e-12 && Math.abs((m0 + (rawHi - m0) * f0) - c1.hi) < 1e-12, 'BCa-Rueckrechnung inkonsistent');
  ok(rawLo <= m0 && m0 <= rawHi, 'rohes BCa enthaelt das Mittel nicht');
  // psi=1 & sv=s -> identische Scores -> Delta exakt 0
  const ch = makeChains(1, 0, makeRng(3));
  const w = boardICs(ch.boards[0], { s: S_BASE, sv: S_BASE, psi: 1 });
  ok(Math.abs(w.icV - w.icB) < 1e-12, 'psi=1 liefert kein Delta 0');
  ok(tieShare(w.sq) > 0.15, 'zu wenige Bindungen — Score-Quantisierung greift nicht');
  // Bootstrap-t liefert ein Intervall um das Mittel
  const bt = bootTci(pts, 800, makeRng(9));
  ok(bt && bt[0] < m0 && m0 < bt[1], 'Bootstrap-t kaputt');
  return true;
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const num = (f, d) => { const i = a.indexOf(f); return i >= 0 ? Number(a[i + 1]) : d; };
  return { reps: num('--reps', 2500), B: num('--B', 2000), probe: a.includes('--probe') };
}

function main() {
  const t0 = Date.now();
  selfCheck();
  const args = parseArgs();
  const reps = args.probe ? 40 : args.reps;
  const B = args.probe ? 600 : args.B;
  const seMax = Math.sqrt(0.25 / reps) * 100, se85 = Math.sqrt(0.85 * 0.15 / reps) * 100;
  process.stderr.write(`[k1-rep-b] seed=${SEED} M=${M} K=${KBOARDS} reps=${reps} B=${B}\n`);

  // 1) Kalibrierung + Wahrheit je Konfiguration
  const cfgs = [];
  let cs = SEED;
  for (const rho of RHO_GRID) for (const delta of DELTA_GRID) {
    const sv = S_BASE + delta * Math.sqrt(1 + SIGMA_R * SIGMA_R);
    const psi = calibratePsi(rho, sv, cs++);
    for (const ac of AC_GRID) {
      const model = { s: S_BASE, sv, psi };
      const cal = calibratePhi(ac, model, cs++, args.probe ? 4000 : PILOT_WINDOWS);
      const phi = cal.phi, pilot = cal.pilot;
      const cross = runSeries(model, phi, args.probe ? 500 : CROSS_WINDOWS, cs++, KBOARDS).cross;
      if (Math.abs(pilot.ac - ac) > AC_TOL) {
        throw new Error(`KALIBRIERUNG GESCHEITERT: Ziel-AC ${ac}, realisiert ${pilot.ac.toFixed(3)} `
          + `(rho=${rho}, delta=${delta}) — die AC-Achse feuert nicht, Messung waere wertlos.`);
      }
      cfgs.push({ rho, delta, ac, psi, phi, model, pilot, cross });
      process.stderr.write(`[cal] rho*=${rho} d*=${delta} ac*=${ac} -> psi=${psi.toFixed(4)} phi=${phi.toFixed(4)}`
        + ` | rho_ist=${pilot.rho.toFixed(3)} ac_ist=${pilot.ac.toFixed(3)} cross=${cross.toFixed(3)}`
        + ` | wahr=${pilot.meanD.toFixed(5)} sd=${pilot.sdD.toFixed(4)} icB=${pilot.meanIcB.toFixed(3)} ties=${pilot.ties.toFixed(2)}\n`);
    }
  }

  // 2) Ueberdeckungsgitter
  const rows = [];
  let ss = SEED * 3;
  for (const cfg of cfgs) for (const n of N_GRID) {
    const cov = {}, half = {}, miss = {};
    for (const c of CAND) { cov[c] = 0; half[c] = 0; miss[c] = 0; }
    let f0Sum = 0, f0One = 0, f2Sum = 0, f2One = 0, acSampleSum = 0, neSum = 0, nePSum = 0;
    const truth = cfg.pilot.meanD;
    for (let r = 0; r < reps; r++) {
      const rng = makeRng((ss + r * 7919) >>> 0);
      const ch = makeChains(KBOARDS, cfg.phi, rng);
      const fam = []; for (let k = 0; k < KBOARDS; k++) fam.push(new Array(n));
      for (let t = 0; t < n; t++) {
        if (t > 0) ch.step();
        for (let k = 0; k < KBOARDS; k++) { const w = boardICs(ch.boards[k], cfg.model); fam[k][t] = w.icV - w.icB; }
      }
      const points = fam[0];
      const res = allCandidates(points, fam, B, (ss + r * 104729) >>> 0, rng);
      f0Sum += res.f0; if (res.f0 <= 1 + 1e-12) f0One++;
      f2Sum += res.f2; if (res.f2 <= 1 + 1e-12) f2One++;
      neSum += res.ne; nePSum += res.neP;
      acSampleSum += lag1(points);
      for (const c of CAND) {
        const ci = res.cis[c];
        if (!ci || !Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) { miss[c]++; continue; }
        if (ci[0] <= truth && truth <= ci[1]) cov[c]++;
        half[c] += (ci[1] - ci[0]) / 2;
      }
    }
    ss += reps * 13;
    const row = {
      n, rho: cfg.rho, ac: cfg.ac, delta: cfg.delta, truth,
      acReal: cfg.pilot.ac, acSample: acSampleSum / reps, rhoReal: cfg.pilot.rho, cross: cfg.cross,
      f0: f0Sum / reps, f0OneShare: f0One / reps, f2: f2Sum / reps, f2OneShare: f2One / reps,
      neMean: neSum / reps, nePMean: nePSum / reps,
      cov: {}, half: {}, rel: {}, miss,
    };
    for (const c of CAND) { row.cov[c] = 100 * cov[c] / reps; row.half[c] = half[c] / Math.max(1, reps - miss[c]); }
    for (const c of CAND) row.rel[c] = row.half[c] / row.half.R0;
    rows.push(row);
    process.stderr.write(`[grid] n=${n} rho=${cfg.rho} ac=${cfg.ac} d=${cfg.delta} -> `
      + CAND.map((c) => `${c} ${row.cov[c].toFixed(1)}`).join(' | ')
      + ` (t=${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }

  // 3) Ausgabe
  const out = [];
  const pct = (x) => (x.toFixed(1) + '%').padStart(7);
  out.push('K1-REPARATUR-MESSUNG (ARM B) — nominal 90 %, Latte ' + BAR + ' %');
  out.push(`Seed ${SEED} | M=${M} Titel/Fenster | SCORE_SD=${SCORE_SD.toFixed(2)} | K=${KBOARDS} Boards/Familie (KAPPA=${KAPPA})`);
  out.push(`reps=${reps} | B=${B} | Blocklaenge=${BLOCK} | SE(Ueberdeckung) <= ${seMax.toFixed(2)} pp (p=0,5), ${se85.toFixed(2)} pp bei p=0,85`);
  out.push('');
  out.push('KANDIDATEN: R0 Ist | R1 t auf N_eff | R2 gepoolte AC | R3 R1+R2 | R4 Bootstrap-t | R5a f=1,30 | R5b f=1,50');
  out.push('');
  out.push('UEBERDECKUNG je Zelle (%)');
  out.push(' n   rho   ac  dTrue |' + CAND.map((c) => c.padStart(7)).join('') + ' | ac_pop ac_stich | f0_mittel f0=1 | f2_mittel');
  out.push('-'.repeat(132));
  for (const r of rows) {
    out.push(String(r.n).padStart(2) + '  ' + r.rho.toFixed(2) + '  ' + r.ac.toFixed(1) + '  ' + r.delta.toFixed(2) + '   |'
      + CAND.map((c) => pct(r.cov[c])).join('') + ' |'
      + r.acReal.toFixed(3).padStart(7) + r.acSample.toFixed(3).padStart(9) + ' |'
      + r.f0.toFixed(3).padStart(10) + (100 * r.f0OneShare).toFixed(0).padStart(5) + '%'
      + r.f2.toFixed(3).padStart(10));
  }
  out.push('');
  out.push('BREITEN-PREIS: mittlere CI-Halbbreite relativ zu R0 (1,00 = gleich breit)');
  out.push(' n   rho   ac  dTrue |' + CAND.map((c) => c.padStart(7)).join(''));
  out.push('-'.repeat(74));
  for (const r of rows) {
    out.push(String(r.n).padStart(2) + '  ' + r.rho.toFixed(2) + '  ' + r.ac.toFixed(1) + '  ' + r.delta.toFixed(2) + '   |'
      + CAND.map((c) => r.rel[c].toFixed(2).padStart(7)).join(''));
  }
  out.push('');
  out.push('ZUSAMMENFASSUNG je Kandidat');
  out.push('Kand  schlechteste  mittlere  Zellen<' + BAR + '  Breite_rel  Breite_rel_max  Urteil');
  out.push('-'.repeat(78));
  const summary = [];
  for (const c of CAND) {
    const cs2 = rows.map((r) => r.cov[c]);
    const worst = Math.min(...cs2), avg = cs2.reduce((a, b) => a + b, 0) / cs2.length;
    const fails = cs2.filter((v) => v < BAR).length;
    const rel = rows.map((r) => r.rel[c]);
    const relMean = rel.reduce((a, b) => a + b, 0) / rel.length, relMax = Math.max(...rel);
    const missTot = rows.reduce((a, r) => a + r.miss[c], 0);
    summary.push({ name: c, worst, mean: avg, fails, relMean, relMax, miss: missTot, pass: worst >= BAR });
    out.push(c.padEnd(6) + (worst.toFixed(1) + '%').padStart(12) + (avg.toFixed(1) + '%').padStart(10)
      + String(fails).padStart(10) + relMean.toFixed(2).padStart(12) + relMax.toFixed(2).padStart(16)
      + '  ' + (worst >= BAR ? 'HAELT' : 'FAELLT'));
  }
  const holders = summary.filter((s) => s.pass).sort((a, b) => a.relMean - b.relMean);
  out.push('');
  out.push('URTEIL:');
  if (!holders.length) {
    out.push('  KEIN Kandidat haelt ' + BAR + ' % in JEDER Zelle. Die Latte wird nicht gesenkt.');
    const best = summary.slice().sort((a, b) => b.worst - a.worst)[0];
    out.push(`  Bester: ${best.name} mit ${best.worst.toFixed(1)} % in der schlechtesten Zelle (Breite ${best.relMean.toFixed(2)}x R0).`);
  } else {
    for (const h of holders) {
      out.push(`  ${h.name}: schlechteste Zelle ${h.worst.toFixed(1)} % (${(h.worst - BAR).toFixed(1)} pp Abstand zur Latte, `
        + `>= ${(se85).toFixed(2)} pp SE), mittlere Breite ${h.relMean.toFixed(2)}x R0, max ${h.relMax.toFixed(2)}x.`);
    }
    out.push(`  EMPFEHLUNG: ${holders[0].name} — haelt mit dem geringsten Breiten-Preis.`);
  }
  out.push('');
  out.push('LAUFZEIT: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  out.push('');
  out.push('---JSON---');
  out.push(JSON.stringify({
    seed: SEED, reps, B, M, K: KBOARDS, kappa: KAPPA, level: LEVEL, block: BLOCK, bar: BAR,
    seMaxPp: seMax, se85Pp: se85, candidates: CAND, summary, rows,
  }));
  process.stdout.write(out.join('\n') + '\n');
}

if (require.main === module) main();
module.exports = { selfCheck, nEffFast, pooledNeff, tQuantile, bootTci, allCandidates, runSeries, makeRng, makeChains, boardICs };
