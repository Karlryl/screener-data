#!/usr/bin/env node
'use strict';
/**
 * K1-Ueberdeckungs-Simulation (ARM A) — reine Messung, aendert nichts am Repo.
 *
 * FRAGE: Haelt das produktive Block-Bootstrap-CI aus scripts/rank-ic.js sein
 * 90-%-Versprechen, wenn nur n = 8..12 gepaarte Messfenster vorliegen?
 * LATTE: tatsaechliche Ueberdeckung >= 85 % in JEDER Zelle des Gitters.
 *
 * Gemessen wird die ECHTE Maschinerie: bootstrapCI/nEff/spearman werden aus
 * scripts/rank-ic.js importiert, nichts davon ist hier nachgebaut.
 *   bootstrapCI(points, level, B, seed, blockLen)  -> {lo, hi, p}
 *   blockLen default = BOOTSTRAP_BLOCK_LEN = 2 (wir lassen den Default stehen,
 *   genau wie evaluateObserved() es tut: bootstrapCI(points, CI_LEVEL, B, seed))
 *   CI_LEVEL = 0.90, BOOTSTRAP_B = 10000
 *   Enthalten ist damit automatisch die N_eff-Verbreiterung f = sqrt(n/nEff)
 *   (Karl-Entscheid E-20260719-1) inkl. Kendall-Bias-Korrektur in nEff().
 *
 * DATENERZEUGENDES MODELL (pro Fenster ein Querschnitt, so wie die Vintages):
 *   K Titel, Score 0..100 mit sd~17.5 (an board-history/2026-07-28 geeicht:
 *   sd 16.9..18.6, Kohorten 84..1198 Zeilen, Score auf 1 Dezimale gerundet).
 *   - g_i ~ N(0,1)             "wahre Qualitaet"
 *   - Live-Basis  sb_i = g_i + tauB * eb_i
 *   - Variante    sv_i = g_i + tauV_w * ev_i,  ev = c*eb + sqrt(1-c^2)*e2
 *     c steuert die Aehnlichkeit -> kalibriert auf das Ziel-rho = corr(IC_v, IC_b)
 *   - Rendite     r_i = b_w * g_i + N(0,1)
 *   - b_w  AR(1) mit Lag-1 phi  -> autokorreliert BEIDE ICs
 *   - d_w  AR(1) mit Lag-1 phi, tauV_w = tauV*exp(d_w)
 *     -> autokorreliert die DIFFERENZ. Ohne diesen zweiten Treiber kuerzt sich
 *        das gemeinsame Regime bei hohem rho weg und die Autokorrelations-Achse
 *        waere gegenstandslos (der ehrlichere, haertere Fall).
 *   - Quantisierung: Score auf 0..100 skaliert und auf 1 Dezimale gerundet
 *     (das ist die operative Stufe: die Achsen-pct sind ebenfalls 1-dezimal,
 *      der gewichtete Score wird aber selbst wieder 1-dezimal eingefroren).
 *
 * WAHRER WERT: mu_true wird NICHT gesetzt, sondern gross-N gemessen (Pilot),
 * getrennt fuer quantisiert/unquantisiert — genau daraus faellt der
 * Quantisierungs-Effekt als Zahl heraus. Ueberdeckung wird gegen den mu_true
 * derselben Zelle geprueft (sonst wuerde man Bias statt CI-Qualitaet messen).
 *
 * WIEDERHOLUNGEN: SE(p) = sqrt(p(1-p)/R) < 0.01 verlangt im schlechtesten Fall
 * (p=0.5) R > 2500. R = 2500 => SE <= 1.00 pp, bei p~0.87 nur 0.67 pp.
 *
 * Aufruf:  node scripts/k1-coverage-sim-a.js
 */

const path = require('path');
const os = require('os');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const { bootstrapCI, nEff, spearman } = require(path.join(__dirname, 'rank-ic.js'));

// ---------------------------------------------------------------- Parameter
const SEED = 20260729;
const REPS = 2500;              // SE(Ueberdeckung) <= 1.00 pp im worst case p=0.5
const LEVEL = 0.90;             // = CI_LEVEL in rank-ic.js
const B_MAIN = 10000;           // = BOOTSTRAP_B in rank-ic.js
const B_ALT = 2000;             // nur fuer die B-Sensitivitaets-Messung
const K = Number(process.env.K1_K) || 120;   // Titel je Fenster (real: 84..1198)
const SCORE_SD = 17.5;          // real gemessen 16.9..18.6
const MU_B = 0.15, SD_B = 0.12; // Signalstaerke-Regime -> IC-Niveau ~0.10
const TAU_B = 1.0;              // Rauschen der Live-Basis
const SD_D = 0.35;              // Schwankung des Varianten-Vorteils ueber die Zeit
const GRID_N = [8, 10, 12];
const GRID_RHO = [0.5, 0.7, 0.9, 0.95, 0.99];
const GRID_PHI = [0.0, 0.3];
const GRID_QUANT = [false, true];
const DELTA_TARGET = [0, 0.03];
const PILOT_RHO = 4000, BISECT_STEPS = 16;
const PILOT_MU = Number(process.env.K1_PILOT_MU) || 60000;
const PILOT_TAU = Number(process.env.K1_PILOT_TAU) || 20000, TAU_STEPS = 14;
// K1_DAMPING=1: nur den Quantisierungs-Effekt fuer eine andere Kohortengroesse messen.
const DAMPING_ONLY = process.env.K1_DAMPING === '1';
const LATTE = 0.85;

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
// Score auf die reale Skala bringen (0..100, sd ~17.5) und optional einfrieren.
function toScore(raw, quant, out) {
  const n = raw.length;
  let m = 0; for (let i = 0; i < n; i++) m += raw[i]; m /= n;
  let ss = 0; for (let i = 0; i < n; i++) ss += (raw[i] - m) ** 2;
  const sd = Math.sqrt(ss / (n - 1)) || 1;
  for (let i = 0; i < n; i++) {
    let s = 50 + SCORE_SD * (raw[i] - m) / sd;
    if (s < 0) s = 0; else if (s > 100) s = 100;
    out[i] = quant ? Math.round(s * 10) / 10 : s;
  }
  return out;
}

/** Erzeugt eine Fensterreihe und liefert die gepaarten Deltas + Diagnose. */
function genSeries(n, P, norm) {
  const rawB = new Array(K), rawV = new Array(K), ret = new Array(K);
  const scB = new Array(K), scV = new Array(K);
  const deltas = new Array(n);
  let identical = 0;
  const cc = Math.sqrt(Math.max(0, 1 - P.c * P.c));
  // AR(1)-Zustaende, aus der stationaeren Verteilung gestartet (kein Burn-in noetig)
  let zb = norm(), zd = norm();
  for (let w = 0; w < n; w++) {
    if (w > 0) {
      const k = Math.sqrt(1 - P.phi * P.phi);
      zb = P.phi * zb + k * norm();
      zd = P.phi * zd + k * norm();
    }
    const b = MU_B + SD_B * zb;
    const tauVw = P.tauV * Math.exp(SD_D * zd);
    for (let i = 0; i < K; i++) {
      const g = norm(), eb = norm(), e2 = norm();
      const ev = P.c * eb + cc * e2;
      rawB[i] = g + TAU_B * eb;
      rawV[i] = g + tauVw * ev;
      ret[i] = b * g + norm();
    }
    toScore(rawB, P.quant, scB);
    toScore(rawV, P.quant, scV);
    const icB = spearman(scB, ret);
    const icV = spearman(scV, ret);
    const d = (icV === null || icB === null) ? 0 : icV - icB;
    if (d === 0) identical++;
    deltas[w] = d;
  }
  return { deltas, identical };
}

function corr(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
}
/** Pilot: liefert IC-Paare (phi-unabhaengig, daher phi=0). */
function pilotPairs(count, P, norm) {
  const icb = new Array(count), icv = new Array(count);
  const rawB = new Array(K), rawV = new Array(K), ret = new Array(K);
  const scB = new Array(K), scV = new Array(K);
  const cc = Math.sqrt(Math.max(0, 1 - P.c * P.c));
  for (let w = 0; w < count; w++) {
    const b = MU_B + SD_B * norm();
    const tauVw = P.tauV * Math.exp(SD_D * norm());
    for (let i = 0; i < K; i++) {
      const g = norm(), eb = norm(), e2 = norm();
      rawB[i] = g + TAU_B * eb;
      rawV[i] = g + tauVw * (P.c * eb + cc * e2);
      ret[i] = b * g + norm();
    }
    toScore(rawB, P.quant, scB); toScore(rawV, P.quant, scV);
    icb[w] = spearman(scB, ret) || 0;
    icv[w] = spearman(scV, ret) || 0;
  }
  return { icb, icv };
}
/**
 * Quantisierungs-Effekt GEPAART: quantisiert und unquantisiert aus IDENTISCHEN
 * Ziehungen. Ungepaart (getrennte RNG-Stroeme) ist der SE der Differenz ~0.001
 * und damit groesser als der Effekt selbst — die Zahl waere Rauschen.
 */
function pilotQuantPaired(count, tauV, norm) {
  const rawB = new Array(K), rawV = new Array(K), ret = new Array(K);
  const oB = new Array(K), oV = new Array(K), qB = new Array(K), qV = new Array(K);
  let sOff = 0, sOn = 0, sDiff = 0, ssDiff = 0, identical = 0;
  for (let w = 0; w < count; w++) {
    const b = MU_B + SD_B * norm();
    const tauVw = tauV * Math.exp(SD_D * norm());
    for (let i = 0; i < K; i++) {
      const g = norm(), eb = norm(), e2 = norm();
      rawB[i] = g + TAU_B * eb;
      rawV[i] = g + tauVw * e2;   // c=0: mu_true ist c-invariant (ev ~ N(0,1) fuer jedes c)
      ret[i] = b * g + norm();
    }
    toScore(rawB, false, oB); toScore(rawV, false, oV);
    toScore(rawB, true, qB); toScore(rawV, true, qV);
    const dOff = (spearman(oV, ret) || 0) - (spearman(oB, ret) || 0);
    const dOn = (spearman(qV, ret) || 0) - (spearman(qB, ret) || 0);
    if (dOn === 0) identical++;
    sOff += dOff; sOn += dOn; sDiff += dOn - dOff; ssDiff += (dOn - dOff) ** 2;
  }
  const mDiff = sDiff / count;
  return {
    off: sOff / count, on: sOn / count, diff: mDiff,
    seDiff: Math.sqrt(Math.max(0, ssDiff / count - mDiff * mDiff) / count),
    identShare: identical / count,
  };
}

// t-Quantil 0.95 (einseitig) fuer df 1..30, linear interpoliert — nur fuer die
// Ursachen-Probe, NICHT fuer die Ueberdeckungsmessung selbst.
const T95 = [6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812,
  1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725,
  1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697];
function t95(df) {
  if (df <= 1) return T95[0];
  if (df >= 30) return 1.645 + (T95[29] - 1.645) * 30 / df;
  const i = Math.floor(df), fr = df - i;
  return T95[i - 1] + fr * (T95[Math.min(29, i)] - T95[i - 1]);
}
function sdOf(v) {
  const n = v.length, m = v.reduce((s, x) => s + x, 0) / n;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
}

// =============================================================== Worker-Teil
if (!isMainThread && workerData.diag) {
  // Ursachen-Probe: dieselben Daten, vier Intervall-Varianten gegeneinander.
  const out = [];
  for (const cell of workerData.cells) {
    const norm = makeNorm(makeRng(cell.seed));
    let prod = 0, tNe = 0, sProd = 0, sNe = 0;
    for (let r = 0; r < REPS; r++) {
      const { deltas } = genSeries(cell.n, cell, norm);
      const ci = bootstrapCI(deltas, LEVEL, cell.B, (cell.seed + r * 7919) >>> 0);
      const mean = deltas.reduce((s, x) => s + x, 0) / cell.n;
      const ne = nEff(deltas);
      const hit = (lo, hi) => (lo <= cell.muTrue && cell.muTrue <= hi) ? 1 : 0;
      prod += hit(ci.lo, ci.hi);
      // (a) reines t-Intervall auf N_eff (kein Bootstrap)
      const h = t95(Math.max(1, ne - 1)) * sdOf(deltas) / Math.sqrt(ne);
      tNe += hit(mean - h, mean + h);
      // (b) Produktions-CI nur um den df-Faktor t(n-1)/z gedehnt
      const k1 = t95(cell.n - 1) / 1.645;
      sProd += hit(mean - (mean - ci.lo) * k1, mean + (ci.hi - mean) * k1);
      // (c) Produktions-CI um t(N_eff-1)/z gedehnt
      const k2 = t95(Math.max(1, ne - 1)) / 1.645;
      sNe += hit(mean - (mean - ci.lo) * k2, mean + (ci.hi - mean) * k2);
    }
    out.push({ ...cell, prod: prod / REPS, tNe: tNe / REPS, sProd: sProd / REPS, sNe: sNe / REPS });
  }
  parentPort.postMessage(out);
  return;
}
if (!isMainThread) {
  const out = [];
  for (const cell of workerData.cells) {
    const norm = makeNorm(makeRng(cell.seed));
    let cov = 0, missLo = 0, missHi = 0, wsum = 0, nesum = 0, degen = 0, ident = 0, ac = 0, nanCi = 0;
    for (let r = 0; r < REPS; r++) {
      const { deltas, identical } = genSeries(cell.n, cell, norm);
      ident += identical;
      const ci = bootstrapCI(deltas, LEVEL, cell.B, (cell.seed + r * 7919) >>> 0);
      if (!ci || !Number.isFinite(ci.lo) || !Number.isFinite(ci.hi)) { nanCi++; continue; }
      if (ci.lo <= cell.muTrue && cell.muTrue <= ci.hi) cov++;
      else if (cell.muTrue < ci.lo) missHi++; else missLo++;
      wsum += ci.hi - ci.lo;
      nesum += nEff(deltas);
      if (ci.hi === ci.lo) degen++;
      ac += corr(deltas.slice(0, -1), deltas.slice(1));
    }
    const ok = REPS - nanCi;
    out.push({
      ...cell,
      coverage: cov / REPS, missLo: missLo / REPS, missHi: missHi / REPS,
      width: wsum / Math.max(1, ok), nEffMean: nesum / Math.max(1, ok),
      degen: degen / REPS, identShare: ident / (REPS * cell.n),
      acRealized: ac / Math.max(1, ok), nanCi,
    });
  }
  parentPort.postMessage(out);
  return;
}

// ================================================================ Main-Teil
(async function main() {
  const t0 = Date.now();
  console.log('K1-Ueberdeckungs-Simulation ARM A — Seed ' + SEED + ', ' + REPS + ' Wiederholungen je Zelle');
  console.log('SE(Ueberdeckung) <= sqrt(0.25/' + REPS + ') = ' + (Math.sqrt(0.25 / REPS) * 100).toFixed(2) + ' pp (worst case p=0.5)\n');

  // --- 1) tauV kalibrieren: mittleres Delta-IC = 0 bzw. 0.03 (unquantisiert)
  const tauVfor = { 0: TAU_B };
  {
    let lo = 0.30, hi = 1.0;
    for (let s = 0; s < TAU_STEPS; s++) {
      const mid = (lo + hi) / 2;
      const norm = makeNorm(makeRng(SEED + 101 + s));
      const p = pilotPairs(PILOT_TAU, { c: 0, tauV: mid, quant: false }, norm);
      let m = 0; for (let i = 0; i < PILOT_TAU; i++) m += p.icv[i] - p.icb[i];
      m /= PILOT_TAU;
      if (m > 0.03) lo = mid; else hi = mid;   // kleineres tauV => besserer Proxy => groesseres Delta
    }
    tauVfor[0.03] = (lo + hi) / 2;
  }
  console.log('tauV kalibriert: Delta=0 -> ' + TAU_B.toFixed(4) + ' | Delta=0.03 -> ' + tauVfor[0.03].toFixed(4) + '  (tauB=' + TAU_B + ')');

  // --- 2) mu_true gross-N messen, je (quant, delta). Haengt NICHT von c ab:
  //     ev ~ N(0,1) fuer jedes c, die Randverteilung von sv ist c-invariant.
  const muTrue = {};
  console.log('\nWahres mittleres Delta-IC, GEPAART gemessen (Pilot ' + PILOT_MU + ' Fenster, K=' + K + '):');
  for (const dt of DELTA_TARGET) {
    const norm = makeNorm(makeRng(SEED + 201 + Math.round(dt * 1000)));
    const p = pilotQuantPaired(PILOT_MU, tauVfor[dt], norm);
    muTrue[dt + '|false'] = p.off;
    muTrue[dt + '|true'] = p.on;
    const rel = Math.abs(p.off) > 1e-3 ? (-p.diff / p.off * 100) : null;
    console.log('  Ziel ' + dt.toFixed(2) + ': unquantisiert ' + p.off.toFixed(5)
      + ' | quantisiert ' + p.on.toFixed(5)
      + ' | Differenz ' + p.diff.toFixed(6) + ' +/- ' + p.seDiff.toFixed(6) + ' (SE, gepaart)'
      + (rel === null ? '  (Nullfall: relative Daempfung undefiniert)'
        : '  => Daempfung ' + rel.toFixed(2) + ' % +/- ' + (p.seDiff / Math.abs(p.off) * 100).toFixed(2) + ' pp')
      + ' | Anteil Fenster mit Delta==0: ' + (p.identShare * 100).toFixed(2) + ' %');
  }

  // --- 2b) Haerteste Quantisierungs-Frage: wie SCHWACH darf die Variante von der
  //     Basis abweichen, bevor das 0,1-Raster sie auffrisst? Variante = Basis-Score
  //     plus eine Verschiebung von D Score-Punkten je Titel (D in Punkten der 0..100-Skala).
  {
    console.log('\nQuantisierungs-Haertetest (Variante = Basis + D Punkte Verschiebung, K=' + K + '):');
    const N = 20000;
    for (const D of [0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 3.0]) {
      const norm = makeNorm(makeRng(SEED + 401));
      const oB = new Array(K), oV = new Array(K), qB = new Array(K), qV = new Array(K);
      const rawB = new Array(K), rawV = new Array(K), ret = new Array(K);
      let sOff = 0, sOn = 0, ident = 0;
      for (let w = 0; w < N; w++) {
        const b = MU_B + SD_B * norm();
        for (let i = 0; i < K; i++) {
          const g = norm();
          rawB[i] = g + TAU_B * norm();
          ret[i] = b * g + norm();
        }
        toScore(rawB, false, oB);
        for (let i = 0; i < K; i++) { rawV[i] = oB[i] + D * norm(); oV[i] = rawV[i]; }
        for (let i = 0; i < K; i++) { qB[i] = Math.round(oB[i] * 10) / 10; qV[i] = Math.round(oV[i] * 10) / 10; }
        const dOff = (spearman(oV, ret) || 0) - (spearman(oB, ret) || 0);
        const dOn = (spearman(qV, ret) || 0) - (spearman(qB, ret) || 0);
        if (dOn === 0) ident++;
        sOff += Math.abs(dOff); sOn += Math.abs(dOn);
      }
      const keep = sOff === 0 ? 1 : sOn / sOff;
      console.log('  D=' + D.toFixed(2).padStart(5) + ' Punkte: |Delta| unquant ' + (sOff / N).toFixed(5)
        + ' -> quant ' + (sOn / N).toFixed(5) + '  (erhalten ' + (keep * 100).toFixed(1) + ' %)'
        + '  Fenster mit Delta==0: ' + (ident / N * 100).toFixed(1) + ' %');
    }
  }

  if (DAMPING_ONLY) { console.log('(nur Daempfungs-Messung, K=' + K + ')'); return; }

  // --- 3) c kalibrieren: corr(IC_v, IC_b) = Ziel-rho, je (rho, quant, delta)
  const cFor = {};
  for (const rho of GRID_RHO) for (const q of GRID_QUANT) for (const dt of DELTA_TARGET) {
    let lo = -0.95, hi = 0.9999;
    for (let s = 0; s < BISECT_STEPS; s++) {
      const mid = (lo + hi) / 2;
      const norm = makeNorm(makeRng(SEED + 301 + s));
      const p = pilotPairs(PILOT_RHO, { c: mid, tauV: tauVfor[dt], quant: q }, norm);
      if (corr(p.icb, p.icv) < rho) lo = mid; else hi = mid;
    }
    cFor[rho + '|' + q + '|' + dt] = (lo + hi) / 2;
  }
  console.log('\nc-Kalibrierung (Aehnlichkeit der Rausch-Terme) fertig nach ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s.');

  // --- 4) Zellen bauen
  const cells = [];
  let sd = 1;
  for (const n of GRID_N) for (const rho of GRID_RHO) for (const phi of GRID_PHI)
    for (const q of GRID_QUANT) for (const dt of DELTA_TARGET) {
      cells.push({
        n, rho, phi, quant: q, deltaTarget: dt, B: B_MAIN,
        c: cFor[rho + '|' + q + '|' + dt], tauV: tauVfor[dt],
        muTrue: muTrue[dt + '|' + q], seed: (SEED + 1000 * sd++) >>> 0,
      });
    }
  // B-Sensitivitaet: 5 Spiegelzellen mit identischem Seed => identische Daten,
  // nur B unterschiedlich -> gepaarter Vergleich.
  const mirrors = cells.filter((c) => c.n === 10 && c.phi === 0.3 && c.quant === true && c.deltaTarget === 0.03)
    .map((c) => ({ ...c, B: B_ALT, mirrorOf: c.seed }));
  const all = cells.concat(mirrors);
  console.log('Zellen: ' + cells.length + ' Haupt + ' + mirrors.length + ' B-Spiegel, je ' + REPS + ' Wiederholungen.\n');

  // --- 5) parallel rechnen
  const nw = Math.min(12, Math.max(1, os.cpus().length - 2));
  const chunks = Array.from({ length: nw }, () => []);
  all.forEach((c, i) => chunks[i % nw].push(c));
  const results = (await Promise.all(chunks.filter((ch) => ch.length).map((ch) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { cells: ch } });
    w.on('message', res); w.on('error', rej);
    w.on('exit', (code) => { if (code !== 0) rej(new Error('Worker exit ' + code)); });
  })))).flat();

  // --- 6) Ausgabe
  const rows = results.filter((r) => !r.mirrorOf).sort((a, b) =>
    a.n - b.n || a.deltaTarget - b.deltaTarget || a.rho - b.rho || a.phi - b.phi || (a.quant ? 1 : 0) - (b.quant ? 1 : 0));
  const pct = (x) => (x * 100).toFixed(1).padStart(5);
  console.log('  n | rho  | phi | quant | Delta | Ueberdeck | miss<lo miss>hi | CI-Breite | N_eff | AC(delta) | ident');
  console.log('----+------+-----+-------+-------+-----------+-----------------+-----------+-------+-----------+------');
  for (const r of rows) {
    const flag = r.coverage < LATTE ? ' <<< ROT' : '';
    console.log('  ' + String(r.n).padStart(2) + ' | ' + r.rho.toFixed(2) + ' | ' + r.phi.toFixed(1)
      + ' |  ' + (r.quant ? 'ja ' : 'nein') + '  | ' + r.deltaTarget.toFixed(2)
      + '  |   ' + pct(r.coverage) + ' % |  ' + pct(r.missLo) + '  ' + pct(r.missHi)
      + ' |   ' + r.width.toFixed(4) + '  | ' + r.nEffMean.toFixed(2).padStart(5)
      + ' |   ' + r.acRealized.toFixed(3).padStart(6) + '  | ' + pct(r.identShare) + '%' + flag);
  }

  const worst = rows.reduce((a, b) => (b.coverage < a.coverage ? b : a));
  const failed = rows.filter((r) => r.coverage < LATTE);
  console.log('\nSchlechteste Zelle: ' + (worst.coverage * 100).toFixed(1) + ' % '
    + '(n=' + worst.n + ', rho=' + worst.rho + ', phi=' + worst.phi + ', quant=' + worst.quant + ', Delta=' + worst.deltaTarget + ')');
  console.log('Zellen unter ' + (LATTE * 100) + ' %: ' + failed.length + ' von ' + rows.length);
  console.log('URTEIL K1: ' + (failed.length === 0 ? 'GRUEN (Latte gehalten)' : 'ROT (Latte gerissen)'));

  // B-Sensitivitaet (gepaart, identische Daten)
  console.log('\nB-Sensitivitaet (gleiche Daten, B=' + B_ALT + ' statt ' + B_MAIN + '):');
  let maxShift = 0;
  for (const m of results.filter((r) => r.mirrorOf)) {
    const base = rows.find((r) => r.seed === m.mirrorOf);
    const d = m.coverage - base.coverage;
    if (Math.abs(d) > Math.abs(maxShift)) maxShift = d;
    console.log('  rho=' + m.rho.toFixed(2) + ': ' + (base.coverage * 100).toFixed(1) + ' % -> '
      + (m.coverage * 100).toFixed(1) + ' %  (' + (d * 100 >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' pp)');
  }
  console.log('  groesste Verschiebung: ' + (maxShift * 100).toFixed(1) + ' pp — B=' + B_MAIN + ' bleibt der ausgewiesene Lauf.');

  // --- 7) Ursachen-Probe: woran liegt die Unterdeckung?
  const diagCells = rows.filter((r) => r.quant === true && r.deltaTarget === 0.03
    && (r.rho === 0.5 || r.rho === 0.99));
  const diag = (await Promise.all(diagCells.map((c) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { cells: [c], diag: true } });
    w.on('message', res); w.on('error', rej);
    w.on('exit', (code) => { if (code !== 0) rej(new Error('Worker exit ' + code)); });
  })))).flat();
  console.log('\nURSACHEN-PROBE (quant=ja, Delta=0.03) — gleiche Daten, vier Intervalle:');
  console.log('  n | rho  | phi | Produktion | t-Int(N_eff) | Prod x t(n-1)/z | Prod x t(N_eff-1)/z');
  for (const d of diag.sort((a, b) => a.n - b.n || a.rho - b.rho || a.phi - b.phi)) {
    console.log('  ' + String(d.n).padStart(2) + ' | ' + d.rho.toFixed(2) + ' | ' + d.phi.toFixed(1)
      + ' |    ' + pct(d.prod) + ' % |      ' + pct(d.tNe) + ' % |         ' + pct(d.sProd)
      + ' % |            ' + pct(d.sNe) + ' %');
  }

  const nan = rows.reduce((s, r) => s + r.nanCi, 0);
  if (nan) console.log('\nWARNUNG: ' + nan + ' CIs nicht endlich (als Fehlschlag gezaehlt).');
  console.log('\nLaufzeit ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s.');

  // ponytail: eine Selbstprobe statt Test-Suite — faellt um, wenn die Verdrahtung bricht.
  const chk = bootstrapCI([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], LEVEL, 500, 1);
  console.assert(Math.abs(chk.lo - 0.1) < 1e-9 && Math.abs(chk.hi - 0.1) < 1e-9, 'bootstrapCI-Verdrahtung kaputt');
  console.assert(rows.length === GRID_N.length * GRID_RHO.length * GRID_PHI.length * 4, 'Gitter unvollstaendig');
})();
