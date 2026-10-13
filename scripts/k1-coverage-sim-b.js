'use strict';
/**
 * scripts/k1-coverage-sim-b.js — K1-Vorbedingung (ARM B), Monte-Carlo.
 *
 * FRAGE: Haelt das 90-%-Block-Bootstrap-CI aus scripts/rank-ic.js (bootstrapCI,
 * inkl. der E-20260719-1-Verbreiterung um sqrt(n/N_eff)) sein Versprechen, wenn
 * nur n = 8..12 gepaarte Messfenster vorliegen?
 * AKZEPTANZ: tatsaechliche Ueberdeckung >= 85 % bei nominal 90 %, ueber das
 * gesamte rho-Gitter. Die Latte wird hier NICHT gesenkt und nicht verhandelt.
 *
 * AUFBAU (bewusst cross-sectional, nicht IC-Ebene direkt):
 *   Jedes Fenster ist eine echte Kohorte von M Aktien. Score und Forward-Return
 *   werden je Aktie erzeugt, der IC entsteht durch Aufruf des ECHTEN
 *   spearman() aus rank-ic.js — damit wirken Bindungen (Ties) durch die
 *   1-Dezimal-Quantisierung genau so, wie sie in der echten Rechnung wirken.
 *   Die CI-Auswertung ruft das ECHTE bootstrapCI(points, 0.90, B, seed, 2) auf.
 *   Nichts davon ist nachgebaut.
 *
 * GENERATIVES MODELL je Fenster t (alle Latenten AR(1) ueber t, Koeffizient phi,
 * stationaer initialisiert — deshalb kein Burn-in noetig):
 *   u        ~ N(0,1)                      "wahre Qualitaet" der Aktie
 *   R        = u + sigmaR * eta            Forward-Return (NICHT quantisiert)
 *   Cb       = s  * u + sqrt(1-s^2)  * (sqrt(psi)*c + sqrt(1-psi)*b)   Live-Basis
 *   Cv       = sv * u + sqrt(1-sv^2) * (sqrt(psi)*c + sqrt(1-psi)*v)   Variante
 *   Score    = clamp(50 + SCORE_SD * C, 0, 100)   [quantisiert: auf 0,1 gerundet]
 *   psi steuert rho (Korrelation der beiden Fenster-ICs),
 *   sv - s steuert das WAHRE mittlere Delta-IC,
 *   phi steuert die Lag-1-Autokorrelation der Delta-Reihe.
 *   psi und phi werden per Bisektion auf die Zielwerte kalibriert (nicht geraten),
 *   die realisierten Werte werden ausgewiesen.
 *
 * KALIBRIERUNG AN ECHTEN DATEN (board-history/2026-07-28, 13 Boards, gemessen):
 *   Score traegt genau 1 Dezimale, Mittel ~50, SD ~17,5, Median-Kohorte n=341,
 *   Median-Bindungsanteil 0,455. Massgeblich fuer die Ties ist die Dichte
 *   "Zeilen je 0,1-Bin im Zentrum" = M * phi(0) / (10*SD) = 0,78 beim Median-Board.
 *   Aus Laufzeitgruenden simuliert dieses Skript M = 180 statt 341 Aktien und
 *   skaliert SCORE_SD = 17,5 * 180/341 = 9,24 — damit bleibt die Bin-Dichte und
 *   damit die Bindungsstruktur identisch zum Median-Board.
 *   Die Achsen-Perzentile werden bewusst NICHT zusaetzlich modelliert: bei n=341
 *   Kohortenzeilen betraegt ein Perzentil-Rangschritt 100/341 = 0,29; eine Rundung
 *   auf 0,1 verschiebt eine Achse um <= 0,05 = 17 % eines Rangschritts, und der
 *   gewichtete Mittelwert aus 7 Achsen um <= 0,02 Rangschritte. Die gemessenen
 *   26-82 % Bindungen stammen nachweislich aus der Rundung des SCORE selbst
 *   (maxDec=1 auf score in jedem Board) — die Achsenrundung ist zweiter Ordnung.
 *
 * Aufruf:
 *   node scripts/k1-coverage-sim-b.js [--reps 2500] [--B 2000] [--probe]
 * Schreibt nichts. Ergebnis auf stdout (Tabelle + JSON-Block).
 */

const path = require('path');
const { bootstrapCI, nEff, spearman } = require(path.join(__dirname, 'rank-ic.js'));

// ── Konstanten ───────────────────────────────────────────────────────────────
const SEED = 20260729;
const CI_LEVEL = 0.90;          // wie rank-ic.js CI_LEVEL
const BLOCK_LEN = 2;            // wie rank-ic.js BOOTSTRAP_BLOCK_LEN
const M = 180;                  // Aktien je Fenster (Laufzeit; SCORE_SD mitskaliert)
// SCORE_SD skaliert mit M, damit die Bindungsdichte (Zeilen je 0,1-Bin) dem Median-Board
// entspricht. Ueber K1_SCORE_SD ueberschreibbar, um die Bindungsdichte anderer Boards zu
// pruefen (z. B. industrials: 1198 Zeilen, SD 17,5 -> Dichte 2,73 -> K1_SCORE_SD=2.63 bei M=180).
const SCORE_SD = Number(process.env.K1_SCORE_SD) || (17.5 * M / 341);
const S_BASE = 0.11;            // Signal-Ladung der Live-Basis
const SIGMA_R = 0.30;           // Return-Rauschen  -> Basis-IC ~0,105
const DELTA_TARGETS = [0, 0.03];
const RHO_GRID = [0.5, 0.7, 0.9, 0.95, 0.99];
const N_GRID = [8, 10, 12];
const AC_GRID = [0.0, 0.3];
// PILOT_WINDOWS setzt die Genauigkeit der "Wahrheit", gegen die ueberdeckt wird:
// sd(Fenster-Delta) ~ 0,07 => SE der Wahrheit = 0,07/sqrt(25000) = 4,6e-4, das sind
// ~1 % einer typischen CI-Halbbreite. Der dadurch verursachte Ueberdeckungsfehler
// liegt unter 0,3 pp und damit unter dem Monte-Carlo-Rauschen.
const PILOT_WINDOWS = 25000;    // fuer "Wahrheit" (wahres mittleres Delta-IC)
const CAL_WINDOWS = 1500;       // fuer Bisektion psi/phi

// ── RNG (deterministisch, mulberry32 + Box-Muller) ───────────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  let spare = null;
  const u01 = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, r = 0;
    do { u = 2 * u01() - 1; v = 2 * u01() - 1; r = u * u + v * v; } while (r === 0 || r >= 1);
    const f = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * f;
    return u * f;
  };
  return { u01, normal };
}

// ── Fenster-Kette: 5 latente Vektoren, AR(1) ueber Fenster, stationaer initial ─
function makeChain(m, phi, rng) {
  const k = Math.sqrt(1 - phi * phi);
  const arrs = [];
  for (let a = 0; a < 5; a++) {
    const x = new Float64Array(m);
    for (let i = 0; i < m; i++) x[i] = rng.normal();   // N(0,1) = stationaere Verteilung
    arrs.push(x);
  }
  return {
    arrs,
    step() {
      if (phi === 0) { for (const x of arrs) for (let i = 0; i < m; i++) x[i] = rng.normal(); return; }
      for (const x of arrs) for (let i = 0; i < m; i++) x[i] = phi * x[i] + k * rng.normal();
    },
  };
}

const clamp100 = (x) => (x < 0 ? 0 : x > 100 ? 100 : x);

// Ein Fenster auswerten -> vier ICs (Basis/Variante x roh/quantisiert).
// spearman() ist das ECHTE aus rank-ic.js (Durchschnittsraenge bei Ties).
function windowICs(chain, cfg) {
  const m = M;
  const [u, eta, cShared, bNoise, vNoise] = chain.arrs;
  const s = cfg.s, sv = cfg.sv, psi = cfg.psi;
  const wb = Math.sqrt(1 - s * s), wv = Math.sqrt(1 - sv * sv);
  const sq = Math.sqrt(psi), sq1 = Math.sqrt(1 - psi);
  const R = new Array(m), SB = new Array(m), SV = new Array(m), SBq = new Array(m), SVq = new Array(m);
  for (let i = 0; i < m; i++) {
    R[i] = u[i] + SIGMA_R * eta[i];
    const shared = sq * cShared[i];
    const cb = s * u[i] + wb * (shared + sq1 * bNoise[i]);
    const cv = sv * u[i] + wv * (shared + sq1 * vNoise[i]);
    const xb = clamp100(50 + SCORE_SD * cb);
    const xv = clamp100(50 + SCORE_SD * cv);
    SB[i] = xb; SV[i] = xv;
    SBq[i] = Math.round(xb * 10) / 10;   // 1-Dezimal-Quantisierung wie im Vintage
    SVq[i] = Math.round(xv * 10) / 10;
  }
  return {
    icB: spearman(SB, R), icV: spearman(SV, R),
    icBq: spearman(SBq, R), icVq: spearman(SVq, R),
    sq: SBq,
  };
}

function tieShare(vals) {
  const cnt = new Map();
  for (const v of vals) cnt.set(v, (cnt.get(v) || 0) + 1);
  let t = 0; for (const c of cnt.values()) if (c > 1) t += c;
  return t / vals.length;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
}
const lag1 = (a) => (a.length < 3 ? 0 : pearson(a.slice(0, -1), a.slice(1)));

// Lange Fensterreihe erzeugen -> Kennzahlen (roh + quantisiert).
function runSeries(cfg, phi, windows, seed) {
  const rng = makeRng(seed);
  const chain = makeChain(M, phi, rng);
  const icB = [], icV = [], icBq = [], icVq = [], dRaw = [], dQ = [];
  let ties = 0;
  for (let t = 0; t < windows; t++) {
    if (t > 0) chain.step();
    const w = windowICs(chain, cfg);
    icB.push(w.icB); icV.push(w.icV); icBq.push(w.icBq); icVq.push(w.icVq);
    dRaw.push(w.icV - w.icB); dQ.push(w.icVq - w.icBq);
    if (t % 50 === 0) ties += tieShare(w.sq);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  return {
    rhoRaw: pearson(icB, icV), rhoQ: pearson(icBq, icVq),
    acRaw: lag1(dRaw), acQ: lag1(dQ),
    meanDRaw: mean(dRaw), meanDQ: mean(dQ),
    sdDRaw: sd(dRaw), sdDQ: sd(dQ),
    meanIcB: mean(icB), meanIcBq: mean(icBq),
    tieShare: ties / Math.ceil(windows / 50),
  };
}

// ── Kalibrierung: psi -> rho, phi -> Autokorrelation (Bisektion, monoton) ─────
function calibratePsi(rhoTarget, sv, seed) {
  let lo = 0, hi = 1, best = 0.5;
  for (let it = 0; it < 11; it++) {
    const mid = (lo + hi) / 2;
    const r = runSeries({ s: S_BASE, sv, psi: mid }, 0, CAL_WINDOWS, seed).rhoRaw;
    best = mid;
    if (r < rhoTarget) lo = mid; else hi = mid;
  }
  return best;
}
function calibratePhi(acTarget, cfg, seed) {
  if (acTarget === 0) return 0;
  let lo = 0, hi = 0.95, best = 0.5;
  for (let it = 0; it < 9; it++) {
    const mid = (lo + hi) / 2;
    const a = runSeries(cfg, mid, CAL_WINDOWS * 2, seed).acRaw;
    best = mid;
    if (a < acTarget) lo = mid; else hi = mid;
  }
  return best;
}

// ── Selbstcheck (faellt laut aus, wenn die Mechanik anders tickt als angenommen) ─
function selfCheck() {
  const assert = (c, msg) => { if (!c) throw new Error('SELFCHECK: ' + msg); };
  assert(Math.abs(spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) - 1) < 1e-12, 'spearman identisch != 1');
  // Quantisierung muss Bindungen erzeugen und den gemessenen IC daempfen
  const rng = makeRng(1);
  const ch = makeChain(M, 0, rng);
  const w = windowICs(ch, { s: S_BASE, sv: S_BASE, psi: 1 });
  assert(tieShare(w.sq) > 0.2, 'Quantisierung erzeugt zu wenige Bindungen (Kalibrierung stimmt nicht)');
  assert(Math.abs(w.icB - w.icV) < 1e-12, 'psi=1 & sv=s muss identische Scores liefern (Delta exakt 0)');
  // bootstrapCI: reproduzierbar bei gleichem Seed, enthaelt das Stichprobenmittel
  const pts = [0.01, 0.04, 0.02, 0.05, 0.00, 0.03, 0.06, 0.02, 0.01, 0.04];
  const a = bootstrapCI(pts, CI_LEVEL, 2000, 42, BLOCK_LEN);
  const b = bootstrapCI(pts, CI_LEVEL, 2000, 42, BLOCK_LEN);
  assert(a.lo === b.lo && a.hi === b.hi, 'bootstrapCI nicht reproduzierbar');
  const m0 = pts.reduce((x, y) => x + y, 0) / pts.length;
  assert(a.lo < m0 && m0 < a.hi, 'CI enthaelt nicht einmal das eigene Stichprobenmittel');
  assert(nEff(pts) > 0, 'nEff kaputt');
  return true;
}

// ── Hauptlauf ────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag, def) => { const i = a.indexOf(flag); return i >= 0 ? Number(a[i + 1]) : def; };
  return { reps: get('--reps', 2500), B: get('--B', 2000), probe: a.includes('--probe'), Bref: get('--Bref', 10000) };
}

function main() {
  const t0 = Date.now();
  selfCheck();
  const args = parseArgs();
  const reps = args.probe ? 60 : args.reps;
  const B = args.B;
  process.stderr.write(`[k1-b] seed=${SEED} M=${M} SCORE_SD=${SCORE_SD.toFixed(2)} reps=${reps} B=${B}\n`);

  // benoetigte Wiederholungen: SE = sqrt(p(1-p)/R); worst case p=0,5 -> R >= 2500 fuer SE <= 1,0 pp.
  const seMax = Math.sqrt(0.25 / reps) * 100;
  const seAt90 = Math.sqrt(0.9 * 0.1 / reps) * 100;

  // 1) Kalibrierung + Pilot je Konfiguration
  const configs = [];
  let cseed = SEED;
  for (const rho of RHO_GRID) {
    for (const delta of DELTA_TARGETS) {
      const sv = S_BASE + delta * Math.sqrt(1 + SIGMA_R * SIGMA_R);
      const psi = calibratePsi(rho, sv, cseed++);
      for (const ac of AC_GRID) {
        const phi = calibratePhi(ac, { s: S_BASE, sv, psi }, cseed++);
        const pilot = runSeries({ s: S_BASE, sv, psi }, phi, PILOT_WINDOWS, cseed++);
        configs.push({ rho, delta, ac, psi, phi, sv, pilot });
        process.stderr.write(`[cal] rho*=${rho} d*=${delta} ac*=${ac} -> psi=${psi.toFixed(4)} phi=${phi.toFixed(4)}`
          + ` | rho_ist=${pilot.rhoRaw.toFixed(3)}/${pilot.rhoQ.toFixed(3)} ac_ist=${pilot.acRaw.toFixed(3)}`
          + ` | wahr dRaw=${pilot.meanDRaw.toFixed(4)} dQ=${pilot.meanDQ.toFixed(4)} ties=${pilot.tieShare.toFixed(3)}\n`);
      }
    }
  }

  // 2) Ueberdeckungsgitter
  const rows = [];
  let sseed = SEED * 3;
  for (const cfg of configs) {
    for (const n of N_GRID) {
      let covRaw = 0, covQ = 0, widthRaw = 0, widthQ = 0, nEffSum = 0;
      const model = { s: S_BASE, sv: cfg.sv, psi: cfg.psi };
      for (let r = 0; r < reps; r++) {
        const rng = makeRng((sseed + r * 7919) >>> 0);
        const chain = makeChain(M, cfg.phi, rng);
        const dR = new Array(n), dQ = new Array(n);
        for (let t = 0; t < n; t++) {
          if (t > 0) chain.step();
          const w = windowICs(chain, model);
          dR[t] = w.icV - w.icB; dQ[t] = w.icVq - w.icBq;
        }
        const bs = (sseed + r * 104729) >>> 0;
        const ciR = bootstrapCI(dR, CI_LEVEL, B, bs, BLOCK_LEN);
        const ciQ = bootstrapCI(dQ, CI_LEVEL, B, bs + 1, BLOCK_LEN);
        if (ciR.lo <= cfg.pilot.meanDRaw && cfg.pilot.meanDRaw <= ciR.hi) covRaw++;
        if (ciQ.lo <= cfg.pilot.meanDQ && cfg.pilot.meanDQ <= ciQ.hi) covQ++;
        widthRaw += ciR.hi - ciR.lo; widthQ += ciQ.hi - ciQ.lo;
        nEffSum += nEff(dR);
      }
      sseed += reps * 13;
      rows.push({
        n, rho: cfg.rho, ac: cfg.ac, delta: cfg.delta,
        covRaw: 100 * covRaw / reps, covQ: 100 * covQ / reps,
        widthRaw: widthRaw / reps, widthQ: widthQ / reps,
        nEffMean: nEffSum / reps,
        truthRaw: cfg.pilot.meanDRaw, truthQ: cfg.pilot.meanDQ,
        sdWindowRaw: cfg.pilot.sdDRaw,
        rhoReal: cfg.pilot.rhoRaw, acReal: cfg.pilot.acRaw,
      });
      process.stderr.write(`[grid] n=${n} rho=${cfg.rho} ac=${cfg.ac} d=${cfg.delta}`
        + ` -> roh ${(100 * covRaw / reps).toFixed(1)}% | quant ${(100 * covQ / reps).toFixed(1)}%`
        + ` (t=${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
    }
  }

  // 3) B-Sensitivitaet: die 4 schlechtesten Zellen zusaetzlich mit B=Bref
  const worst = rows.slice().sort((a, b) => Math.min(a.covRaw, a.covQ) - Math.min(b.covRaw, b.covQ)).slice(0, 8);
  const bCheck = [];
  let bseed = SEED * 11;
  for (const w0 of worst) {
    const cfg = configs.find((c) => c.rho === w0.rho && c.ac === w0.ac && c.delta === w0.delta);
    const model = { s: S_BASE, sv: cfg.sv, psi: cfg.psi };
    const repsB = Math.min(reps, 800);
    let cR = 0, cQ = 0, cR2 = 0, cQ2 = 0;
    for (let r = 0; r < repsB; r++) {
      const rng = makeRng((bseed + r * 7919) >>> 0);
      const chain = makeChain(M, cfg.phi, rng);
      const dR = new Array(w0.n), dQ = new Array(w0.n);
      for (let t = 0; t < w0.n; t++) {
        if (t > 0) chain.step();
        const w = windowICs(chain, model);
        dR[t] = w.icV - w.icB; dQ[t] = w.icVq - w.icBq;
      }
      const bs = (bseed + r * 104729) >>> 0;
      const a1 = bootstrapCI(dR, CI_LEVEL, B, bs, BLOCK_LEN);
      const a2 = bootstrapCI(dQ, CI_LEVEL, B, bs + 1, BLOCK_LEN);
      const b1 = bootstrapCI(dR, CI_LEVEL, args.Bref, bs, BLOCK_LEN);
      const b2 = bootstrapCI(dQ, CI_LEVEL, args.Bref, bs + 1, BLOCK_LEN);
      if (a1.lo <= cfg.pilot.meanDRaw && cfg.pilot.meanDRaw <= a1.hi) cR++;
      if (a2.lo <= cfg.pilot.meanDQ && cfg.pilot.meanDQ <= a2.hi) cQ++;
      if (b1.lo <= cfg.pilot.meanDRaw && cfg.pilot.meanDRaw <= b1.hi) cR2++;
      if (b2.lo <= cfg.pilot.meanDQ && cfg.pilot.meanDQ <= b2.hi) cQ2++;
    }
    bseed += repsB * 13;
    bCheck.push({
      n: w0.n, rho: w0.rho, ac: w0.ac, delta: w0.delta, reps: repsB,
      covB: 100 * cR / repsB, covBref: 100 * cR2 / repsB,
      covBq: 100 * cQ / repsB, covBrefq: 100 * cQ2 / repsB,
    });
    process.stderr.write(`[Bcheck] n=${w0.n} rho=${w0.rho} ac=${w0.ac} d=${w0.delta}: `
      + `B=${B} ${(100 * cR / repsB).toFixed(1)}%/${(100 * cQ / repsB).toFixed(1)}% vs `
      + `B=${args.Bref} ${(100 * cR2 / repsB).toFixed(1)}%/${(100 * cQ2 / repsB).toFixed(1)}%\n`);
  }

  // 4) Ausgabe
  const out = [];
  out.push('K1-UEBERDECKUNGSSIMULATION (ARM B) — nominal 90 %, Latte 85 %');
  out.push(`Seed ${SEED} | M=${M} Aktien/Fenster | SCORE_SD=${SCORE_SD.toFixed(2)} | reps=${reps} | B=${B} | Blocklaenge=${BLOCK_LEN}`);
  out.push(`SE der Ueberdeckungsquote: <= ${seMax.toFixed(2)} pp (worst case p=0,5), ${seAt90.toFixed(2)} pp bei p=0,90`);
  out.push('');
  out.push(' n  rho*  ac*  dTrue |   roh  quant | rho_ist ac_ist | wahr_roh wahr_quant | CI-Breite roh/quant | N_eff');
  out.push('-'.repeat(112));
  for (const r of rows) {
    out.push(
      String(r.n).padStart(2) + '  ' + r.rho.toFixed(2) + '  ' + r.ac.toFixed(1) + '  ' + r.delta.toFixed(2) + '  |'
      + (r.covRaw.toFixed(1) + '%').padStart(7) + (r.covQ.toFixed(1) + '%').padStart(7) + ' |'
      + r.rhoReal.toFixed(3).padStart(8) + r.acReal.toFixed(3).padStart(7) + ' |'
      + r.truthRaw.toFixed(4).padStart(9) + r.truthQ.toFixed(4).padStart(11) + ' |'
      + (r.widthRaw.toFixed(4) + '/' + r.widthQ.toFixed(4)).padStart(20) + ' |'
      + r.nEffMean.toFixed(2).padStart(7));
  }
  const worstAll = Math.min(...rows.map((r) => Math.min(r.covRaw, r.covQ)));
  out.push('');
  out.push('URTEIL: schlechteste Zelle = ' + worstAll.toFixed(1) + ' % -> ' + (worstAll >= 85 ? 'GRUEN (>=85 %)' : 'ROT (<85 %)'));
  const fails = rows.filter((r) => Math.min(r.covRaw, r.covQ) < 85);
  out.push('Zellen unter 85 %: ' + fails.length + ' von ' + (2 * rows.length) + ' Messpunkten (roh+quant getrennt gezaehlt: '
    + rows.filter((r) => r.covRaw < 85).length + ' roh, ' + rows.filter((r) => r.covQ < 85).length + ' quant)');
  // Quantisierungs-Effekt auf das gemessene Delta (nur wo wahres Delta != 0)
  const att = configs.filter((c) => c.delta !== 0).map((c) => c.pilot.meanDQ / c.pilot.meanDRaw);
  const attMean = att.reduce((a, b) => a + b, 0) / att.length;
  out.push('');
  out.push('QUANTISIERUNGS-EFFEKT (nur Zellen mit wahrem Delta != 0):');
  out.push('  gemessenes Delta-IC quantisiert / unquantisiert = ' + attMean.toFixed(4)
    + '  (Daempfung ' + ((1 - attMean) * 100).toFixed(2) + ' %)');
  out.push('  mittlerer Bindungsanteil im simulierten Score: ' + (configs[0].pilot.tieShare).toFixed(3)
    + ' (echte Boards 2026-07-28: Median 0,455)');
  out.push('');
  out.push('B-SENSITIVITAET (B=' + B + ' vs B=' + args.Bref + ', gleiche Ziehungen, 8 schlechteste Zellen):');
  for (const c of bCheck) {
    out.push('  n=' + c.n + ' rho=' + c.rho + ' ac=' + c.ac + ' d=' + c.delta
      + ' | roh ' + c.covB.toFixed(1) + ' -> ' + c.covBref.toFixed(1)
      + ' | quant ' + c.covBq.toFixed(1) + ' -> ' + c.covBrefq.toFixed(1) + ' (pp, reps=' + c.reps + ')');
  }
  const shift = bCheck.length
    ? Math.max(...bCheck.map((c) => Math.max(Math.abs(c.covBref - c.covB), Math.abs(c.covBrefq - c.covBq))))
    : 0;
  out.push('  groesste Verschiebung durch kleineres B: ' + shift.toFixed(1) + ' pp');
  out.push('');
  out.push('LAUFZEIT: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  out.push('');
  out.push('---JSON---');
  out.push(JSON.stringify({
    seed: SEED, reps, B, Bref: args.Bref, M, scoreSd: SCORE_SD, ciLevel: CI_LEVEL, blockLen: BLOCK_LEN,
    seMaxPp: seMax, worstCoverage: worstAll, pass: worstAll >= 85,
    attenuation: attMean, bShiftPp: shift, rows, bCheck,
  }));
  process.stdout.write(out.join('\n') + '\n');
}

if (require.main === module) main();
module.exports = {
  runSeries, windowICs, selfCheck, makeRng, makeChain, calibratePsi, calibratePhi, lag1,
  M, SCORE_SD, S_BASE, SIGMA_R, CI_LEVEL, BLOCK_LEN, SEED,
};
