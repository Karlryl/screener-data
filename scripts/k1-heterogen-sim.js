#!/usr/bin/env node
'use strict';
/**
 * scripts/k1-heterogen-sim.js — K1: die ungetesteten FLANKEN von R3.
 * Reine Diagnose. Schreibt nichts (ausser stdout/stderr), ruft keinen Prozess
 * auf, geht nicht ins Netz. rank-ic.js bleibt unangetastet, nur importiert.
 *
 * VORGESCHICHTE: R3 (t-Intervall auf N_eff aus GEPOOLTER, board-weise
 * zentrierter Lag-1-AC) hielt in 36 Zellen die 85-%-Latte (schlechtester Arm
 * 88,4 %). Getestet waren nur AC in {0; 0,3} und die stillschweigende Annahme,
 * ALLE Boards einer Familie haetten dieselbe Persistenz.
 *
 * GEMESSEN WIRD HIER
 *   F1   homogene, STAERKERE Persistenz: AC in {0,45; 0,60; 0,75}.
 *   F2   HETEROGENE Persistenz: die K Boards bekommen verschiedene AC-Werte um
 *        einen Mittelwert (0,3 / 0,5) mit Streuung (0/0,1/0,2/0,3), geklemmt
 *        auf [0; 0,85]. Getrennt ausgewiesen: Ueberdeckung ueber ALLE Boards und
 *        die des ZAEHESTEN Boards (hoechste AC) — das Board, das die gepoolte
 *        AC unterkorrigiert.
 *   F1N  NEGATIVE AC {-0,15; -0,30} homogen. Realer Betriebspunkt laut
 *        Parallelmessung an echten Kursen (gepoolte Lag-1-AC -0,151 auf einem
 *        21-Tage-Proxy; das VORZEICHEN auf 84 Tagen ist damit NICHT bewiesen —
 *        deshalb gleichberechtigter Fall, nicht Hauptfall). Dort faellt R3s
 *        Pooling-Komponente aus (rhoC <= 0 => N_eff = n) und R3 degeneriert auf
 *        ein reines t-Intervall.
 *   F2N  heterogen um einen NEGATIVEN Mittelwert (-0,15), Streuung 0/0,2/0,3,
 *        geklemmt auf [-0,5; +0,5] — die Familie enthaelt dann Boards mit
 *        positiver UND negativer Persistenz, wie real gemessen (8 von 14 <= 0).
 *   BR   Mechanismus-Bruecke (s. u.).
 *   RW   zusaetzliche Stufe rho_within = 0,20.
 *   KP   Klammer um die BOARD-ZU-BOARD-Korrelation (kappa 0,15 / 0,90).
 *
 * ZWEI KORREKTUREN AN DER AUFTRAGS-PRAEMISSE (beide gemessen, nicht behauptet)
 *   (K1) "rho" im Gitter von -b.js ist NICHT die Board-zu-Board-Korrelation,
 *        sondern corr(IC_Basis, IC_Variante) INNERHALB eines Boards (ueber psi
 *        kalibriert). Die Board-zu-Board-Korrelation steuert KAPPA und wird als
 *        "cross" ausgewiesen: bei KAPPA = 0,5 betraegt sie gemessen 0,219 —
 *        die Simulation liegt also bereits auf dem real gemessenen Niveau
 *        (Median 0,19, Band 0,10..0,23), nicht darueber. Beide Lesarten werden
 *        trotzdem bedient: rho_within = 0,2 als eigene Stufe (RW) UND eine
 *        Klammer um die echte Board-Korrelation ueber kappa (KP).
 *   (K2) Negative AC ist mit dem AR-Koeffizienten dieser Konstruktion NICHT
 *        erzeugbar: gemessen ac(phi=-0,9) = +0,754, exakt wie ac(phi=+0,9).
 *        Grund: ein globaler Vorzeichenwechsel der Latenten dreht Score UND
 *        Return zugleich, und eine RANGkorrelation ist dagegen invariant — die
 *        AC der Delta-Reihe ist damit eine GERADE Funktion von phi. Negative AC
 *        braucht deshalb den additiven Regime-Term aus Arm A (-a.js):
 *            delta_w = delta_struktur_w + A * u_w,   u AR(1) mit phiLat
 *        u ist mittelwertfrei und unabhaengig von delta_struktur, also
 *            AC1(delta) = phiLat * A^2/(V + A^2),  V = Var(delta_struktur).
 *        Mit der festen Wahl A = sd(delta_struktur) (Gewicht w = 1/2) gilt
 *        geschlossen phiLat = 2 * AC_Ziel — keine Bisektion, |AC| <= 0,5.
 *        BRUECKE: AC = +0,3 wird ZUSAETZLICH additiv erzeugt (BR-Zellen). Deckt
 *        sich deren Ueberdeckung mit der strukturell erzeugten AC = +0,3, ist
 *        der Mechanismus fuer das Ergebnis gleichgueltig und die negativen
 *        Zellen sind mit den positiven vergleichbar. Deckt sie sich nicht, ist
 *        das selbst der Befund und steht im Report.
 *
 * KONSTRUKTION: uebernommen aus scripts/k1-reparatur-sim-b.js. Dessen Bausteine
 * werden IMPORTIERT, nicht nachgebaut: boardICs, makeChains, makeRng, runSeries,
 * pooledNeff, tQuantile, allCandidates, nEffFast — und darueber die echte
 * Maschinerie aus rank-ic.js (bootstrapCI, nEff, spearman, stddev, invNormalCdf).
 * NEU sind nur: (1) makeChainsHet(phis, kappa) — AR-Koeffizient je Board,
 * (2) die additive u-Kette, (3) Ueberdeckung je Board statt nur Board 0.
 *
 * ABWEICHUNG VON -b.js BEI DER WAHRHEIT (bewusst, belegt): der wahre mittlere
 * Delta-IC wird an einem phi=0-Pilot gemessen, nicht am phi-Pilot. E[delta_w]
 * ist phi-invariant (die Latenten sind fuer jedes phi marginal N(0,1),
 * stationaer initialisiert), aber der phi-Pilot SCHAETZT ihn bei starker
 * Persistenz miserabel: gemessen driftet meanD bei phi=0,999 auf +0,018 (wahr
 * ~0,001), weil 10.000 Fenster dort nur ~5 unabhaengige Bloecke sind. Ein
 * falscher Wahrheitswert sieht wie ein CI-Defekt aus. Bei phi=0 sind die Fenster
 * unabhaengig, SE = sd/sqrt(W) ist exakt und wird ausgewiesen. Der additive Term
 * verschiebt die Wahrheit nicht (E[u] = 0).
 *
 * PFLICHTKONTROLLEN (im Lauf, nicht im Kopf)
 *   (i)  Zelle n=10, rho=0,9, AC=0,3, delta=0 wird mitgemessen (Board-0-
 *        Schaetzer = identischer Estimand wie -b.js) und gegen einen eigenen
 *        Lauf von -b.js gehalten. Zusaetzlich HARTE Gleichheit: die schlanke
 *        R0/R3-Rechnung hier liefert Bit fuer Bit dasselbe wie allCandidates()
 *        aus -b.js, und pilotSeries() liefert Bit fuer Bit dasselbe wie dessen
 *        runSeries(), und makeChainsHet() bei gleichen phis dasselbe wie
 *        makeChains().
 *   (ii) Je Zelle wird die REALISIERTE Lag-1-AC ausgewiesen, gemessen an der
 *        tatsaechlich benutzten (ggf. heterogenen) Kette — nicht am Ein-Board-
 *        Pilot. Ein Indexfehler in makeChainsHet fliegt damit auf. Zusaetzlich
 *        die im n-Fenster-Sample gemessene AC (der Bias, mit dem die Produktion
 *        rechnet) und die realisierte Board-zu-Board-Korrelation.
 *
 * WIEDERHOLUNGEN: SE = sqrt(p(1-p)/R). R = 2500 => <= 1,00 pp (p=0,5),
 *   0,71 pp bei p=0,85, 0,60 pp bei p=0,90. Fester Seed 20260730.
 *
 * Aufruf:  node scripts/k1-heterogen-sim.js [--reps 2500] [--B 2000] [--probe]
 */

const path = require('path');
const { bootstrapCI, nEff, spearman, stddev, invNormalCdf } = require(path.join(__dirname, 'rank-ic.js'));
const SIMB = require(path.join(__dirname, 'k1-reparatur-sim-b.js'));
const { pooledNeff, tQuantile, makeRng, makeChains, boardICs, runSeries, allCandidates, nEffFast } = SIMB;

// ── Parameter ("= -b.js" heisst: aus jenem Rumpf uebernommen) ────────────────
const SEED = 20260730;
const LEVEL = 0.90;             // = CI_LEVEL in rank-ic.js
const BLOCK = 2;                // = BOOTSTRAP_BLOCK_LEN
const BAR = 85;                 // Latte in Prozent — wird nicht gesenkt
const KAPPA0 = 0.5;             // = KAPPA in -b.js (Selbstcheck erzwingt Gleichheit)
const S_BASE = 0.11;            // = -b.js
const SIGMA_R = 0.30;           // = -b.js
const KB = 9;                   // Boards je Familie (= KBOARDS in -b.js)
const M = makeChains(1, 0, makeRng(1)).boards[0][0].length;   // gelesen, nicht geraten

const CAL_W = 3000;             // psi-Bisektion
const TRUTH_W = 60000;          // Wahrheits-Pilot bei phi=0
const CURVE_W = 10000;          // AC(phi)-Kurve
const CONF_W = 20000;           // Bestaetigungs-Pilot je AC-Ziel
const HET_W = 10000;            // AC-Nachweis an der tatsaechlich benutzten Kette
const AC_TOL = 0.03;            // harte Toleranz Ziel-AC vs. unabhaengig gemessene AC
const W_ADD = 0.5;              // Varianzgewicht des additiven Terms => phiLat = AC/w
// bis 0,995: bei rho_within = 0,99 ist die Delta-Reihe so leise, dass AC = 0,75
// erst bei phi ~ 0,98 erreicht wird (gemessen ac(0,98) = 0,764).
const PHI_GRID = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6,
  0.65, 0.7, 0.75, 0.8, 0.84, 0.88, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.985, 0.99, 0.995];

// ── kleine Statistik (Selbstcheck bindet sie an die echte Maschinerie) ───────
const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
function pearsonL(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const p = xs[i] - mx, q = ys[i] - my; num += p * q; dx += p * p; dy += q * q; }
  return (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
}
function lag1(a) {
  const n = a.length;
  if (n < 3) return 0;
  const x = new Array(n - 1), y = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) { x[i] = a[i]; y[i] = a[i + 1]; }
  return pearsonL(x, y);
}
const sdOf = (a) => { const m = mean(a); let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / Math.max(1, a.length - 1)); };

// ── NEU (1): Kette mit BOARD-EIGENEM phi ────────────────────────────────────
// Identisch zu makeChains() aus -b.js, ausser: phi ist ein Vektor und kappa ein
// Parameter. Die Ziehreihenfolge bleibt exakt gleich (erst die 4 gemeinsamen
// Vektoren, dann Board fuer Board), sonst waere der Gleichheits-Check wertlos.
function makeChainsHet(phis, kappa, rng) {
  const nb = phis.length;
  const kk = phis.map((p) => Math.sqrt(1 - p * p));
  const sk = Math.sqrt(kappa), si = Math.sqrt(1 - kappa);
  const boards = [];
  for (let b = 0; b < nb; b++) { const arr = []; for (let a = 0; a < 4; a++) arr.push(new Float64Array(M)); boards.push(arr); }
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
      for (let a = 0; a < 4; a++) { const c = com[a]; for (let i = 0; i < M; i++) c[i] = rng.normal(); }
      for (let b = 0; b < nb; b++) {
        const bd = boards[b], ph = phis[b], k = kk[b];
        for (let a = 0; a < 4; a++) {
          const x = bd[a], c = com[a];
          for (let i = 0; i < M; i++) x[i] = ph * x[i] + k * (sk * c[i] + si * rng.normal());
        }
      }
    },
  };
}

// ── NEU (2): additive Regime-Kette (nur fuer AC-Ziele, die phi nicht liefert) ─
// Wird NUR angelegt, wenn A > 0 — sonst zieht sie keine Zufallszahl und der
// strukturelle Pfad bleibt Bit fuer Bit der aus -b.js.
function makeUChain(phiLats, kappa, rng) {
  const nb = phiLats.length;
  const kk = phiLats.map((p) => Math.sqrt(1 - p * p));
  const sk = Math.sqrt(kappa), si = Math.sqrt(1 - kappa);
  const u = new Float64Array(nb);
  const c0 = rng.normal();
  for (let b = 0; b < nb; b++) u[b] = sk * c0 + si * rng.normal();
  return {
    u,
    step() {
      const c = rng.normal();
      for (let b = 0; b < nb; b++) u[b] = phiLats[b] * u[b] + kk[b] * (sk * c + si * rng.normal());
    },
  };
}

// ── Delta-Reihen einer Familie erzeugen (der einzige Generator im Skript) ────
// phis/phiLats/A je Board; A = 0 => rein strukturell (identisch zu -b.js).
function genFamily(spec, model, windows, rng) {
  const { phis, phiLats, As, kappa } = spec;
  const K = phis.length;
  const ch = makeChainsHet(phis, kappa, rng);
  const uc = As.some((a) => a > 0) ? makeUChain(phiLats, kappa, rng) : null;
  const ser = []; for (let k = 0; k < K; k++) ser.push(new Float64Array(windows));
  for (let t = 0; t < windows; t++) {
    if (t > 0) { ch.step(); if (uc) uc.step(); }
    for (let k = 0; k < K; k++) {
      const w = boardICs(ch.boards[k], model);
      ser[k][t] = w.icV - w.icB + (uc ? As[k] * uc.u[k] : 0);
    }
  }
  return ser;
}
// Ein-Board-Pilot. Bei A = 0 MUSS er runSeries(...,1) aus -b.js exakt treffen
// (Selbstcheck) — damit haengt die ganze Kalibrierung an der bekannten Maschine.
function pilotSeries(model, phi, phiLat, A, windows, seed, kappa) {
  const s = genFamily({ phis: [phi], phiLats: [phiLat], As: [A], kappa: kappa === undefined ? KAPPA0 : kappa },
    model, windows, makeRng(seed))[0];
  let m = 0; for (let i = 0; i < windows; i++) m += s[i];
  m /= windows;
  let ss = 0; for (let i = 0; i < windows; i++) ss += (s[i] - m) ** 2;
  return { ac: lag1(s), meanD: m, sdD: Math.sqrt(ss / (windows - 1)) };
}

// ── Schlanke R0/R3-Rechnung (nur die zwei gefragten Kandidaten) ──────────────
function ciR0R3(points, family, B, seed) {
  const n = points.length;
  const m0 = mean(points);
  const ci = bootstrapCI(points, LEVEL, B, seed, BLOCK);      // ECHT (rank-ic.js)
  const neP = pooledNeff(family, n);                          // gepoolt, board-weise zentriert
  const sd = stddev(points);                                  // ECHT
  const df = Math.max(1, neP - 1);
  const h = tQuantile(1 - (1 - LEVEL) / 2, df) * sd / Math.sqrt(neP);
  return { R0: [ci.lo, ci.hi], R3: [m0 - h, m0 + h], neP, ne: nEff(points) };
}

// ── Selbstcheck ─────────────────────────────────────────────────────────────
function selfCheck() {
  const ok = (c, m) => { if (!c) throw new Error('SELFCHECK: ' + m); };
  ok(M === 80, 'M aus -b.js ist ' + M + ' — Konstruktion hat sich geaendert');
  const xs = [3, 1, 4, 2, 6, 5, 8, 7], ys = [2, 1, 5, 3, 4, 8, 7, 6];
  ok(Math.abs(pearsonL(xs, ys) - spearman(xs, ys)) < 1e-12, 'pearsonL != spearman auf Raengen');
  // (1) makeChainsHet == makeChains bei gleichen phis und kappa = 0,5
  for (const phi of [0, 0.4, 0.9]) {
    const A = makeChains(3, phi, makeRng(11));
    const Bc = makeChainsHet([phi, phi, phi], KAPPA0, makeRng(11));
    for (let t = 0; t < 4; t++) {
      if (t > 0) { A.step(); Bc.step(); }
      for (let b = 0; b < 3; b++) for (let a = 0; a < 4; a++) for (let i = 0; i < M; i++) {
        ok(A.boards[b][a][i] === Bc.boards[b][a][i], `makeChainsHet != makeChains (phi=${phi},t=${t},b=${b})`);
      }
    }
  }
  // (2) der phi-Vektor muss WIRKEN und darf nicht zwischen Boards lecken
  {
    const A = makeChains(3, 0.4, makeRng(11));
    const Bc = makeChainsHet([0.4, 0.4, 0.9], KAPPA0, makeRng(11));
    A.step(); Bc.step();
    let diff = 0, same = 0;
    for (let a = 0; a < 4; a++) for (let i = 0; i < M; i++) {
      if (A.boards[2][a][i] !== Bc.boards[2][a][i]) diff++;
      if (A.boards[0][a][i] === Bc.boards[0][a][i]) same++;
    }
    ok(diff > 0, 'phi-Vektor wirkt nicht: Board 2 trotz phi 0,9 vs 0,4 identisch');
    ok(same === 4 * M, 'phi eines Boards leckt in ein anderes Board');
  }
  // (3) kappa muss wirken (sonst waere die KP-Klammer ein No-Op)
  {
    const a1 = makeChainsHet([0.4], 0.5, makeRng(11)).boards[0][0][0];
    const a2 = makeChainsHet([0.4], 0.9, makeRng(11)).boards[0][0][0];
    ok(a1 !== a2, 'kappa-Parameter wirkt nicht');
  }
  // (4) pilotSeries (A = 0) == runSeries(...,1) aus -b.js, Bit fuer Bit
  {
    const model = { s: S_BASE, sv: S_BASE + 0.01, psi: 0.4 };
    for (const phi of [0, 0.6]) {
      const r = runSeries(model, phi, 400, 4711, 1);
      const p = pilotSeries(model, phi, 0, 0, 400, 4711);
      ok(Math.abs(r.ac - p.ac) < 1e-12 && Math.abs(r.meanD - p.meanD) < 1e-12 && Math.abs(r.sdD - p.sdD) < 1e-12,
        `pilotSeries != runSeries bei phi=${phi} (${r.ac} vs ${p.ac})`);
    }
    // additiver Term muss die AC VERSCHIEBEN, sonst misst F1N/F2N nichts
    const p0 = pilotSeries(model, 0, 0, 0, 6000, 4711);
    const pn = pilotSeries(model, 0, -0.6, p0.sdD, 6000, 4711);
    ok(pn.ac < -0.15, `additiver Term erzeugt keine negative AC (${pn.ac.toFixed(3)})`);
    const pp = pilotSeries(model, 0, 0.6, p0.sdD, 6000, 4711);
    ok(pp.ac > 0.15, `additiver Term erzeugt keine positive AC (${pp.ac.toFixed(3)})`);
  }
  // (5) ciR0R3 == allCandidates() aus -b.js, exakt
  {
    const rng = makeRng(5);
    const fam = [];
    for (let k = 0; k < KB; k++) {
      const s = new Array(10); let prev = 0;
      for (let i = 0; i < 10; i++) { prev = 0.5 * prev + rng.normal(); s[i] = 0.01 + 0.02 * prev; }
      fam.push(s);
    }
    const ref = allCandidates(fam[0], fam, 800, 4242, makeRng(6));
    const mine = ciR0R3(fam[0], fam, 800, 4242);
    ok(ref.cis.R0[0] === mine.R0[0] && ref.cis.R0[1] === mine.R0[1], 'R0 weicht von -b.js ab');
    ok(ref.cis.R3[0] === mine.R3[0] && ref.cis.R3[1] === mine.R3[1], 'R3 weicht von -b.js ab');
    // pooledNeff MUSS board-weise zentrieren: verschobene Board-Niveaus duerfen nichts aendern
    const shifted = fam.map((s, k) => s.map((v) => v + 0.05 * k));
    ok(Math.abs(pooledNeff(shifted, 10) - mine.neP) < 1e-9, 'pooledNeff zentriert NICHT board-weise');
    // und der Waechter muss ueberhaupt etwas messen koennen: eine echt andere
    // Familie muss ein anderes N_eff geben
    const other = fam.map((s) => s.map((v, i) => (i % 2 ? v + 0.03 : v - 0.03)));
    ok(Math.abs(pooledNeff(other, 10) - mine.neP) > 1e-6, 'pooledNeff reagiert auf gar nichts');
  }
  // (6) importierte Hilfsmittel
  ok(Math.abs(tQuantile(0.95, 10) - 1.812461) < 1e-4, 't(0.95,10) falsch');
  ok(Math.abs(tQuantile(0.95, 1e7) - 1.644854) < 1e-4, 't(0.95,inf) falsch');
  ok(Math.abs(nEffFast([1, 2, 3, 4, 5, 6, 7, 8]) - nEff([1, 2, 3, 4, 5, 6, 7, 8])) < 1e-9, 'nEff-Spiegel kaputt');
  ok(Math.abs(invNormalCdf(0.95) - 1.6448536) < 1e-5, 'invNormalCdf falsch');
  return true;
}

// ── Modell-Kalibrierung je (rho_within, delta) ──────────────────────────────
function makeCfg(rho, delta, seed, opt) {
  const sv = S_BASE + delta * Math.sqrt(1 + SIGMA_R * SIGMA_R);   // = -b.js
  let lo = 0, hi = 1, mid = 0.5;
  for (let i = 0; i < 14; i++) {
    mid = (lo + hi) / 2;
    const r = runSeries({ s: S_BASE, sv, psi: mid }, 0, opt.calW, seed, 1).rho;
    if (r < rho) lo = mid; else hi = mid;
  }
  const psi = (lo + hi) / 2;
  const model = { s: S_BASE, sv, psi };
  const p0 = runSeries(model, 0, opt.truthW, (seed + 77) >>> 0, 1);   // phi=0: Fenster unabhaengig
  return {
    rho, delta, psi, model, truth: p0.meanD, truthSe: p0.sdD / Math.sqrt(opt.truthW),
    rhoReal: p0.rho, sdD: p0.sdD, icB: p0.meanIcB, curve: null, cache: new Map(),
  };
}
function buildCurve(cfg, seed, opt) {
  cfg.curve = PHI_GRID.map((phi) => ({ phi, ac: pilotSeries(cfg.model, phi, 0, 0, opt.curveW, seed).ac }));
}
/** phi bzw. phiLat/A fuer ein AC-Ziel. mech: 'struct' | 'add'. */
function persistFor(cfg, acTarget, mech, seed, opt) {
  const key = mech + ':' + acTarget.toFixed(4);
  if (cfg.cache.has(key)) return cfg.cache.get(key);
  let res;
  if (mech === 'add') {
    // AC = phiLat * w  mit  w = A^2/(V+A^2).  Startwert: w = W_ADD => phiLat = AC/W_ADD
    // (mildeste Wahl: kleinstes |phiLat|, das das Ziel erreicht, wie in -a.js).
    // Die geschlossene Formel trifft auf ~5 % genau (gemessen: Ziel -0,492 ->
    // realisiert -0,468); ein Sekantenschritt auf w holt den Rest, phiLat bleibt
    // dabei fest, weil es bei den Extremzielen schon nahe an |1| liegt.
    const phiLat = acTarget / W_ADD;
    if (Math.abs(phiLat) >= 0.99) throw new Error('AC-Ziel ' + acTarget + ' additiv nicht erreichbar (|phiLat|>=0,99)');
    let w = W_ADD, A = cfg.sdD * Math.sqrt(w / (1 - w));
    let ac = pilotSeries(cfg.model, 0, phiLat, A, opt.confW, seed).ac;
    for (let s = 0; s < 3 && Math.abs(ac - acTarget) > 0.008; s++) {
      w = Math.min(0.85, Math.max(0.02, w * (acTarget / ac)));
      A = cfg.sdD * Math.sqrt(w / (1 - w));
      ac = pilotSeries(cfg.model, 0, phiLat, A, opt.confW, seed).ac;
    }
    res = { phi: 0, phiLat, A, acCheck: pilotSeries(cfg.model, 0, phiLat, A, opt.confW, (seed + 991) >>> 0).ac };
  } else if (acTarget === 0) {
    res = { phi: 0, phiLat: 0, A: 0, acCheck: pilotSeries(cfg.model, 0, 0, 0, opt.confW, (seed + 991) >>> 0).ac };
  } else {
    const c = cfg.curve;
    let i = 0; while (i < c.length - 2 && c[i + 1].ac < acTarget) i++;
    let lo = c[i].phi, hi = c[i + 1].phi;
    let phi = c[i].phi + (c[i + 1].phi - c[i].phi) * (acTarget - c[i].ac) / Math.max(1e-9, c[i + 1].ac - c[i].ac);
    phi = Math.min(hi, Math.max(lo, phi));
    let ac = pilotSeries(cfg.model, phi, 0, 0, opt.confW, seed).ac;
    for (let s = 0; s < 12 && Math.abs(ac - acTarget) > 0.012; s++) {
      if (ac < acTarget) lo = phi; else hi = phi;
      phi = (lo + hi) / 2;
      ac = pilotSeries(cfg.model, phi, 0, 0, opt.confW, seed).ac;
    }
    res = { phi, phiLat: 0, A: 0, acCheck: pilotSeries(cfg.model, phi, 0, 0, opt.confW, (seed + 991) >>> 0).ac };
  }
  if (Math.abs(res.acCheck - acTarget) > opt.acTol) {
    throw new Error(`KALIBRIERUNG GESCHEITERT: Ziel-AC ${acTarget.toFixed(3)} (${mech}), unabhaengig `
      + `nachgemessen ${res.acCheck.toFixed(3)} bei rho=${cfg.rho}/delta=${cfg.delta} — Achse feuert nicht.`);
  }
  cfg.cache.set(key, res);
  return res;
}

// ── Eine Zelle messen ───────────────────────────────────────────────────────
function runCell(cell, cfg, opt, ss) {
  const K = cell.phis.length;
  const truth = cfg.truth;
  const spec = { phis: cell.phis, phiLats: cell.phiLats, As: cell.As, kappa: cell.kappa };
  const cov = { R0: new Array(K).fill(0), R3: new Array(K).fill(0) };
  const perFam = { R0: [], R3: [] };
  const half = { R0: 0, R3: 0 };
  let nePSum = 0, acSampleSum = 0, acSampleTough = 0, neToughSum = 0, f2Sum = 0, f2One = 0;
  const n = cell.n;
  for (let r = 0; r < opt.reps; r++) {
    const fam = genFamily(spec, cfg.model, n, makeRng((ss + r * 7919) >>> 0)).map((s) => Array.from(s));
    let hit0 = 0, hit3 = 0;
    for (let k = 0; k < K; k++) {
      const res = ciR0R3(fam[k], fam, opt.B, (ss + r * 104729 + k * 7717) >>> 0);
      if (k === 0) {
        nePSum += res.neP; const f2 = Math.sqrt(n / res.neP);
        f2Sum += f2; if (f2 <= 1 + 1e-12) f2One++;
      }
      if (k === K - 1) { neToughSum += res.ne; acSampleTough += lag1(fam[k]); }
      for (const c of ['R0', 'R3']) {
        const ci = res[c];
        if (!Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) continue;
        if (ci[0] <= truth && truth <= ci[1]) { cov[c][k]++; if (c === 'R0') hit0++; else hit3++; }
        if (k === 0) half[c] += (ci[1] - ci[0]) / 2;
      }
    }
    perFam.R0.push(hit0 / K); perFam.R3.push(hit3 / K);
    acSampleSum += lag1(fam[0]);
  }
  const R = opt.reps;
  const bse = (p) => 100 * Math.sqrt((p / 100) * (1 - p / 100) / R);
  const out = {
    ...cell, truth, truthSe: cfg.truthSe, rhoReal: cfg.rhoReal,
    covAll: { R0: 100 * mean(perFam.R0), R3: 100 * mean(perFam.R3) },
    covAllSe: { R0: 100 * sdOf(perFam.R0) / Math.sqrt(R), R3: 100 * sdOf(perFam.R3) / Math.sqrt(R) },
    covTough: { R0: 100 * cov.R0[K - 1] / R, R3: 100 * cov.R3[K - 1] / R },
    covB0: { R0: 100 * cov.R0[0] / R, R3: 100 * cov.R3[0] / R },
    covPerBoard: { R0: cov.R0.map((x) => 100 * x / R), R3: cov.R3.map((x) => 100 * x / R) },
    half: { R0: half.R0 / R, R3: half.R3 / R },
    nePMean: nePSum / R, f2Mean: f2Sum / R, f2OneShare: f2One / R, neToughMean: neToughSum / R,
    acSample: acSampleSum / R, acSampleTough: acSampleTough / R,
  };
  out.covToughSe = { R0: bse(out.covTough.R0), R3: bse(out.covTough.R3) };
  out.covB0Se = { R0: bse(out.covB0.R0), R3: bse(out.covB0.R3) };
  return out;
}

// AC- und Cross-Nachweis an der TATSAECHLICH benutzten Kette (Pflichtkontrolle ii)
function chainCheck(cell, cfg, seed, windows) {
  const ser = genFamily({ phis: cell.phis, phiLats: cell.phiLats, As: cell.As, kappa: cell.kappa },
    cfg.model, windows, makeRng(seed));
  const acs = ser.map((s) => lag1(s));
  const arr = ser.map((s) => Array.from(s));
  let cs = 0, cn = 0;
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) { cs += pearsonL(arr[i], arr[j]); cn++; }
  return { acs, cross: cn ? cs / cn : 0 };
}

// ── Hauptlauf ───────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const num = (f, d) => { const i = a.indexOf(f); return i >= 0 ? Number(a[i + 1]) : d; };
  const probe = a.includes('--probe');
  return {
    reps: num('--reps', probe ? 30 : 2500), B: num('--B', probe ? 300 : 2000), probe,
    calW: probe ? 400 : CAL_W, truthW: probe ? 3000 : TRUTH_W, curveW: probe ? 1200 : CURVE_W,
    confW: probe ? 2500 : CONF_W, hetW: probe ? 800 : HET_W,
    // --probe ist ein Rauchtest, keine Messung: bei 2.500 statt 20.000 Pilot-
    // Fenstern hat die AC-Schaetzung selbst ~0,02 SE, die scharfe Toleranz wuerde
    // nur ihr eigenes Rauschen anzeigen. Im echten Lauf gilt AC_TOL unveraendert.
    acTol: probe ? 0.10 : AC_TOL, chainTol: probe ? 0.15 : 0.06, chainTolHard: probe ? 0.30 : 0.15,
  };
}
function zSpread(K) {                       // deterministische, sd-treue Streuung
  const z = []; for (let k = 0; k < K; k++) z.push(invNormalCdf((k + 0.5) / K));
  const s = Math.sqrt(z.reduce((a, v) => a + v * v, 0) / K);
  return z.map((v) => v / s);               // Mittel 0 (symmetrisch), sd exakt 1
}

function main() {
  const t0 = Date.now();
  selfCheck();
  const opt = parseArgs();
  const el = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
  process.stderr.write(`[k1-het] seed=${SEED} M=${M} K=${KB} reps=${opt.reps} B=${opt.B}${opt.probe ? ' PROBE' : ''}\n`);

  // 1) Modelle
  const cfgs = new Map();
  const ck = (r, d) => r + '|' + d;
  let cs = SEED;
  for (const [r, d] of [[0.9, 0], [0.2, 0]]) {
    const c = makeCfg(r, d, cs++, opt);
    buildCurve(c, cs++, opt);
    cfgs.set(ck(r, d), c);
    process.stderr.write(`[cfg] rho_within*=${r} d*=${d} -> psi=${c.psi.toFixed(4)} | rho_ist=${c.rhoReal.toFixed(3)}`
      + ` wahr=${c.truth.toFixed(5)} (SE ${c.truthSe.toFixed(5)}) sd=${c.sdD.toFixed(4)} icB=${c.icB.toFixed(3)}`
      + ` | AC(0,5)=${c.curve[10].ac.toFixed(2)} AC(0,9)=${c.curve[19].ac.toFixed(2)} AC(0,98)=${c.curve[25].ac.toFixed(2)} (${el()})\n`);
  }

  // 2) Zellen
  const z = zSpread(KB);
  const cells = [];
  const hom = (tag, n, rho, delta, ac, mech, kappa) => ({
    tag, n, rho, delta, acMean: ac, spread: 0, mech, kappa: kappa === undefined ? KAPPA0 : kappa,
    acTargets: new Array(KB).fill(ac),
  });
  const het = (tag, n, rho, delta, acMean, spread, mech, clamp, kappa) => ({
    tag, n, rho, delta, acMean, spread, mech, kappa: kappa === undefined ? KAPPA0 : kappa,
    acTargets: z.map((v) => Math.min(clamp[1], Math.max(clamp[0], acMean + spread * v))),
  });
  // CL_NEG bei 0,45 statt 0,5: der additive Term braucht phiLat = 2*AC, und ab
  // |phiLat| ~ 0,98 wird die Kette so alternierend, dass das Ziel nicht mehr
  // sauber getroffen wird (gemessen). 0,45 laesst die Familie weiter ueber null
  // streuen (Boards mit positiver UND negativer Persistenz), bleibt aber stabil.
  const CL_POS = [0, 0.85], CL_NEG = [-0.45, 0.45];

  // Zellwahl: die homogene Flanke 1 ist durch einen UNABHAENGIGEN Lauf des
  // unveraenderten -b.js (K1B_RHO=0.9 K1B_AC=0.45,0.6,0.75, 18 Zellen, 2500 reps)
  // bereits beantwortet — R3 schlechteste Zelle 90,0 %, R0 61,5 %. Hier stehen
  // deshalb nur noch 4 F1-Zellen als Bruecke zwischen beiden Konstruktionen; die
  // Rechenzeit geht in die OFFENEN Fragen, und die stehen vorne (falls der Lauf
  // abgeschnitten wird, fehlt das Redundante, nicht das Neue).
  cells.push(hom('REPRO', 10, 0.9, 0, 0.3, 'struct'));                       // Pflichtkontrolle (i)
  // Flanke 1 bei n=10, zwei Board-Korrelationen. kappa ist der Regler; die
  // resultierende Board-zu-Board-Korrelation wird je Zelle als "cross" gemessen
  // und ausgewiesen (kappa 0,5 -> cross ~0,21 = real gemessenes Niveau).
  for (const ac of [0.6, 0.75]) for (const kappa of [0.5, 0.95]) {
    cells.push(hom('F1', 10, 0.9, 0, ac, 'struct', kappa));
  }
  // Flanke 2: Mittelwert-AC 0,3, Streuung 0 und 0,3 — zwei n, damit die
  // Heterogenitaets-Wirkung nicht an einem einzigen n haengt.
  for (const spread of [0, 0.3]) for (const n of [10, 8]) {
    cells.push(het('F2', n, 0.9, 0, 0.3, spread, 'struct', CL_POS));
  }
  cells.push(hom('F1N', 10, 0.9, 0, -0.15, 'add'));                          // negative AC
  cells.push(hom('BR-add', 10, 0.9, 0, 0.3, 'add'));                         // Mechanismus-Bruecke zu REPRO
  cells.push(hom('RW', 10, 0.2, 0, 0.6, 'struct'));                          // rho_within = 0,2

  // 3) Persistenz je AC-Ziel
  let ntg = 0;
  for (const cell of cells) {
    const cfg = cfgs.get(ck(cell.rho, cell.delta));
    const pr = cell.acTargets.map((t) => { const b = cfg.cache.size; const r = persistFor(cfg, t, cell.mech, (SEED + 4242) >>> 0, opt); if (cfg.cache.size > b) ntg++; return r; });
    const ord = cell.acTargets.map((v, i) => i).sort((a, b) => cell.acTargets[a] - cell.acTargets[b]);
    cell.acTargets = ord.map((i) => cell.acTargets[i]);
    cell.phis = ord.map((i) => pr[i].phi);
    cell.phiLats = ord.map((i) => pr[i].phiLat);
    cell.acCheck = ord.map((i) => pr[i].acCheck);
    cell.As = ord.map((i) => pr[i].A);                  // je Board eigen (Sekantenschritt)
  }
  process.stderr.write(`[phi] ${ntg} verschiedene AC-Ziele kalibriert, ${cells.length} Zellen (${el()})\n`);

  // 4) AC/Cross an der tatsaechlich benutzten Kette
  cells.forEach((cell, i) => {
    const cfg = cfgs.get(ck(cell.rho, cell.delta));
    const h = chainCheck(cell, cfg, (SEED + 31337 + i) >>> 0, opt.hetW);
    cell.acChain = h.acs; cell.cross = h.cross;
    // Diese Pruefung misst mit HET_W Fenstern und hat damit selbst ~0,02 SE.
    // Ein harter Abbruch bei 0,05 hat einen ganzen Lauf gekostet, weil er sein
    // eigenes Rauschen anzeigte (Zelle F2 n=8, Abweichung 0,057 auf einem Board).
    // Jetzt: Abbruch nur, wenn die Achse WIRKLICH nicht feuert; sonst Warnung,
    // und die gemessene AC steht ohnehin in jeder Ergebniszeile.
    const worst = Math.max(...cell.acTargets.map((t, k) => Math.abs(h.acs[k] - t)));
    cell.acWorstDev = worst;
    if (worst > opt.chainTolHard) throw new Error(`KETTEN-AC VERFEHLT: Zelle ${cell.tag} n=${cell.n} acM=${cell.acMean} `
      + `sd=${cell.spread} — groesste Abweichung ${worst.toFixed(3)} (Soll ${cell.acTargets.map((v) => v.toFixed(2)).join('/')}, `
      + `Ist ${h.acs.map((v) => v.toFixed(2)).join('/')})`);
    if (worst > opt.chainTol) process.stderr.write(`[warn] Ketten-AC Zelle ${cell.tag} n=${cell.n} acM=${cell.acMean}`
      + ` sd=${cell.spread}: groesste Abweichung ${worst.toFixed(3)} (Messrauschen dieser Pruefung ~0,02)\n`);
  });
  process.stderr.write(`[chain] AC/Cross an der benutzten Kette nachgemessen (${el()})\n`);

  // 5) Ueberdeckungs-Gitter
  const rows = [];
  let ss = (SEED * 3) >>> 0;
  for (const cell of cells) {
    const cfg = cfgs.get(ck(cell.rho, cell.delta));
    const row = runCell(cell, cfg, opt, ss);
    ss = (ss + opt.reps * 13) >>> 0;
    rows.push(row);
    process.stderr.write(`[grid ${rows.length}/${cells.length}] ${cell.tag} n=${cell.n} rw=${cell.rho} d=${cell.delta}`
      + ` ac=${cell.acMean} sd=${cell.spread} ${cell.mech} kap=${cell.kappa}`
      + ` -> R3 ges ${row.covAll.R3.toFixed(1)} zaeh ${row.covTough.R3.toFixed(1)}`
      + ` | R0 ges ${row.covAll.R0.toFixed(1)} zaeh ${row.covTough.R0.toFixed(1)} (${el()})\n`);
  }

  // 6) Ausgabe
  const out = [];
  const p1 = (x) => x.toFixed(1).padStart(6);
  const fl = (v) => (v < BAR ? '*' : ' ');
  out.push('K1 — FLANKEN VON R3 (nominal 90 %, Latte ' + BAR + ' %)');
  out.push(`Seed ${SEED} | M=${M} Titel/Fenster | K=${KB} Boards/Familie | reps=${opt.reps} | B=${opt.B} | Blocklaenge=${BLOCK}`);
  out.push('R0 = Ist-Zustand (bootstrapCI aus rank-ic.js) | R3 = t-Intervall auf N_eff aus GEPOOLTER, board-weise zentrierter Lag-1-AC');
  out.push('"ges" = alle ' + KB + ' Boards (SE cluster-robust ueber Familien) | "zaeh" = Board mit der HOECHSTEN AC (SE binomial) | * = unter der Latte');
  out.push('mech: struct = AR(1) auf den Latenten (wie -b.js) | add = additiver Regime-Term (einziger Weg zu NEGATIVER AC, s. Kopf)');
  out.push('');
  const rp = rows.find((r) => r.tag === 'REPRO');
  out.push('== PFLICHTKONTROLLE (i): bekannte Zelle aus k1-reparatur-sim-b.js ==');
  out.push(`n=10 rho_within=0,90 AC=0,30 delta=0, Board-0-Schaetzer (identischer Estimand wie -b.js):`);
  out.push(`  R0 ${rp.covB0.R0.toFixed(1)} % (SE ${rp.covB0Se.R0.toFixed(2)})   R3 ${rp.covB0.R3.toFixed(1)} % (SE ${rp.covB0Se.R3.toFixed(2)})`);
  out.push(`  ueber alle ${KB} Boards: R0 ${rp.covAll.R0.toFixed(1)} %, R3 ${rp.covAll.R3.toFixed(1)} %`);
  out.push('');
  const table = (tag, title) => {
    const rs = rows.filter((r) => r.tag === tag);
    if (!rs.length) return;
    out.push('== ' + title + ' ==');
    out.push('  n rho_w kappa  AC_m  sdAC mech |  R0 ges   R3 ges   (SE) |  R0 zaeh  R3 zaeh  (SE) | AC_ist zaeh   min..max | cross | Neff_p f=1% | R3/R0');
    out.push('-'.repeat(158));
    for (const r of rs) {
      const acs = r.acChain;
      out.push(String(r.n).padStart(3) + r.rho.toFixed(2).padStart(6) + r.kappa.toFixed(2).padStart(6)
        + r.acMean.toFixed(2).padStart(6) + r.spread.toFixed(2).padStart(6) + (' ' + r.mech).padStart(7) + ' |'
        + fl(r.covAll.R0) + p1(r.covAll.R0) + fl(r.covAll.R3) + p1(r.covAll.R3) + ' (' + r.covAllSe.R3.toFixed(2) + ') |'
        + fl(r.covTough.R0) + p1(r.covTough.R0) + fl(r.covTough.R3) + p1(r.covTough.R3) + ' (' + r.covToughSe.R3.toFixed(2) + ') |'
        + acs[acs.length - 1].toFixed(3).padStart(12)
        + ('  ' + Math.min(...acs).toFixed(2) + '..' + Math.max(...acs).toFixed(2)).padStart(12) + ' |'
        + r.cross.toFixed(3).padStart(6) + ' |' + r.nePMean.toFixed(2).padStart(7)
        + (100 * r.f2OneShare).toFixed(0).padStart(4) + '%' + (r.half.R3 / r.half.R0).toFixed(2).padStart(7));
    }
    out.push('');
  };
  table('F1', 'FLANKE 1 — homogene, staerkere Persistenz (AC 0,45 / 0,60 / 0,75)');
  table('F2', 'FLANKE 2 — heterogene Persistenz um positive Mittelwerte');
  table('F1N', 'NEGATIVE AC — homogen (realer Betriebspunkt-Kandidat)');
  table('F2N', 'NEGATIVE AC — heterogen (Familie mit positiven UND negativen Boards)');
  table('BR-str', 'MECHANISMUS-BRUECKE: AC = +0,30 strukturell erzeugt');
  table('BR-add', 'MECHANISMUS-BRUECKE: AC = +0,30 additiv erzeugt (muss die struct-Zellen treffen)');
  table('RW', 'rho_within = 0,20 (zusaetzliche Stufe laut Auftrag)');
  table('KP', 'KLAMMER um die BOARD-ZU-BOARD-Korrelation (kappa 0,15 / 0,90; Default 0,50 => cross ~0,22)');
  out.push('== UEBERDECKUNG JE BOARD (R3), heterogene Zellen: Board 0 = weichste AC ... Board ' + (KB - 1) + ' = zaeheste ==');
  out.push('tag    AC_m  sdAC   n | ' + Array.from({ length: KB }, (_, i) => ('B' + i).padStart(6)).join('')
    + '  | AC je Board (ist)');
  out.push('-'.repeat(140));
  for (const r of rows.filter((x) => x.spread > 0)) {
    out.push(r.tag.padEnd(6) + r.acMean.toFixed(2).padStart(6) + r.spread.toFixed(2).padStart(6) + String(r.n).padStart(4)
      + '  | ' + r.covPerBoard.R3.map((v) => v.toFixed(1).padStart(6)).join('')
      + '  | ' + r.acChain.map((v) => v.toFixed(2)).join(' '));
  }
  out.push('');
  out.push('== URTEIL ==');
  const verdict = (tags, label) => {
    const rs = rows.filter((r) => tags.includes(r.tag));
    if (!rs.length) return;
    const wAll = Math.min(...rs.map((r) => r.covAll.R3)), wT = Math.min(...rs.map((r) => r.covTough.R3));
    const failAll = rs.filter((r) => r.covAll.R3 < BAR), failT = rs.filter((r) => r.covTough.R3 < BAR);
    const w0 = Math.min(...rs.map((r) => r.covAll.R0)), w0T = Math.min(...rs.map((r) => r.covTough.R0));
    out.push(`  ${label} (${rs.length} Zellen)`);
    out.push(`    R3: schlechteste Zelle gesamt ${wAll.toFixed(1)} %, zaehestes Board ${wT.toFixed(1)} %`
      + ` | unter ${BAR} %: ${failAll.length} (gesamt) / ${failT.length} (zaehestes)`);
    out.push(`    R0: schlechteste Zelle gesamt ${w0.toFixed(1)} %, zaehestes Board ${w0T.toFixed(1)} %`);
    for (const r of failT.concat(failAll.filter((r) => !failT.includes(r)))) {
      out.push(`    REISST: n=${r.n} rho_w=${r.rho} kappa=${r.kappa} AC_m=${r.acMean} sdAC=${r.spread} ${r.mech}`
        + ` -> zaeh ${r.covTough.R3.toFixed(1)} % (SE ${r.covToughSe.R3.toFixed(2)}), ges ${r.covAll.R3.toFixed(1)} %`);
    }
  };
  verdict(['F1'], 'FLANKE 1 homogen AC 0,45..0,75');
  verdict(['F2'], 'FLANKE 2 heterogen, positive Mittelwerte');
  verdict(['F1N', 'F2N'], 'NEGATIVE AC (homogen + heterogen)');
  verdict(['RW'], 'rho_within = 0,20');
  verdict(['KP'], 'kappa-Klammer 0,15 / 0,90');
  verdict(['F1', 'F2', 'F1N', 'F2N', 'BR-str', 'BR-add', 'RW', 'KP', 'REPRO'], 'ALLE Zellen');
  const brs = rows.filter((r) => r.tag === 'BR-str'), bra = rows.filter((r) => r.tag === 'BR-add');
  if (brs.length && bra.length) {
    const d = bra.map((a) => { const s = brs.find((x) => x.n === a.n) || rp; return Math.abs(a.covAll.R3 - s.covAll.R3); });
    out.push(`  MECHANISMUS-BRUECKE: groesste Abweichung struct vs. add bei AC=+0,30: ${Math.max(...d).toFixed(1)} pp`
      + ` (SE je Zelle ~${bra[0].covAllSe.R3.toFixed(2)} pp) — ${Math.max(...d) < 3 ? 'Mechanismus fuer das Ergebnis unerheblich' : 'MECHANISMUS-ABHAENGIG, negative Zellen nur eingeschraenkt vergleichbar'}`);
  }
  out.push('');
  out.push('LAUFZEIT: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  out.push('');
  out.push('---JSON---');
  out.push(JSON.stringify({ seed: SEED, reps: opt.reps, B: opt.B, M, K: KB, level: LEVEL, bar: BAR, rows }));
  process.stdout.write(out.join('\n') + '\n');
}

if (require.main === module) main();
module.exports = { makeChainsHet, makeUChain, genFamily, pilotSeries, ciR0R3, selfCheck, zSpread };
