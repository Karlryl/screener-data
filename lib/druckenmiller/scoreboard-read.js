'use strict';
/**
 * lib/druckenmiller/scoreboard-read.js — die RECHENWEGE DER LESUNG (R1/R2/R3).
 *
 * DIESES MODUL DARF DER TAGESLAUF NICHT IMPORTIEREN. Es wird ausschliesslich vom Lese-Job
 * geladen ([REV10-5], Call-Path-Test in tests/druckenmiller/read-callpath.test.js). Der
 * Grund ist nicht Hygiene, sondern Vorregistrierung: eine MDE, die taeglich berechnet
 * werden KANN, wird irgendwann taeglich angesehen — und dann ist die Lesung keine Lesung
 * mehr, sondern ein Blick, der sich wiederholt, bis er passt.
 *
 * WAS HIER REGISTRIERT IST (Datei B):
 *  - Schaetzgroesse: Differenz der Anteile "obere Barriere zuerst" (CONFIRMS minus WEAK),
 *    je Arm; zensierte Eintraege zaehlen als NICHT-Ereignis und werden getrennt berichtet.
 *  - Bootstrap: wild-cluster ueber Datums-Bloecke mit Webb-Sechspunkt-Gewichten, solange
 *    die Blockzahl k < 30 ist, sonst gewoehnlicher Cluster-Bootstrap; B = 1.000, Seed fest.
 *  - L = theta - z_(1-alpha*) * SD_boot (einseitig UNTEN, [REV8-1]); die p-Untergrenze der
 *    wilden Variante ist 1/B.
 *  - MDE = (z_(1-alpha*) + z_(1-beta)) * SD_boot ([REV9-2]).
 *
 * WARUM CLUSTER = DATUMS-BLOCK GENUEGT (und die Firmen-Clusterung mit abdeckt): die
 * Abkuehlzeit ist der Horizont und die Blocklaenge ist derselbe Horizont — eine Firma kann
 * pro Arm und Block hoechstens einen Eintritt haben (`assertFirmNesting` prueft das an den
 * echten Eintraegen, statt es zu behaupten).
 */

const B_DEFAULT = 1000;          // Datei B: bootstrap.B
const SEED_DEFAULT = 20260919;   // Datei B: bootstrap.seed
const WILD_MAX_BLOCKS = 30;      // Datei B: bootstrap.wildBelowBlocks
/** Webb-Sechspunkt-Gewichte, jedes mit Wahrscheinlichkeit 1/6. */
const WEBB = [-Math.sqrt(1.5), -1, -Math.sqrt(0.5), Math.sqrt(0.5), 1, Math.sqrt(1.5)];

/** Deterministischer PRNG (mulberry32) — derselbe Seed gibt dieselbe Lesung. */
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Inverse Standardnormal-Verteilung (Acklam, |Fehler| < 1,2e-9). Gebraucht fuer z_(1-a)
 * an sehr kleinen alpha* (0,0083) — eine Tabelle waere hier eine Falle.
 */
function probit(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const istTreffer = (o) => o === 'UP';   // zensiert und DOWN sind beide "kein Treffer"

/** Die Punktschaetzung: Trefferquote CONFIRMS minus Trefferquote WEAK, in Prozentpunkten. */
function pointEstimate(entries) {
  const c = entries.filter((e) => e.state === 'CONFIRMS');
  const w = entries.filter((e) => e.state === 'WEAK');
  if (!c.length || !w.length) return { theta: null, pC: null, pW: null, nC: c.length, nW: w.length };
  const pC = c.filter((e) => istTreffer(e.outcome)).length / c.length;
  const pW = w.filter((e) => istTreffer(e.outcome)).length / w.length;
  return { theta: (pC - pW) * 100, pC, pW, nC: c.length, nW: w.length };
}

/**
 * Einfluss-Beitrag je Eintrag (Prozentpunkte), sodass die Summe ueber alle Eintraege 0 ist
 * und die Blocksummen die Streuung der Schaetzgroesse tragen.
 */
function influences(entries, pe) {
  return entries.map((e) => {
    const t = istTreffer(e.outcome) ? 1 : 0;
    if (e.state === 'CONFIRMS') return ((t - pe.pC) / pe.nC) * 100;
    if (e.state === 'WEAK') return (-(t - pe.pW) / pe.nW) * 100;
    return 0;
  });
}

/** Blocksummen der Einfluss-Beitraege (ein Cluster = ein Datums-Block). */
function blockSums(entries, infl) {
  const m = new Map();
  for (let i = 0; i < entries.length; i++) {
    const k = String(entries[i].block);
    m.set(k, (m.get(k) || 0) + infl[i]);
  }
  return Array.from(m.values());
}

/**
 * Hoechstens ein Eintritt je Firma, Arm und Block — die Bedingung, unter der die
 * Block-Clusterung die Firmen-Clusterung mit abdeckt. Liefert die Verstoesse, statt zu
 * behaupten, es gaebe keine.
 */
function assertFirmNesting(entries) {
  const zaehler = new Map();
  for (const e of entries) {
    const k = `${e.ticker}|${e.arm}|${e.block}`;
    zaehler.set(k, (zaehler.get(k) || 0) + 1);
  }
  const verstoesse = Array.from(zaehler.entries()).filter(([, n]) => n > 1).map(([k, n]) => ({ key: k, n }));
  return { ok: verstoesse.length === 0, violations: verstoesse };
}

/**
 * Die Lesung eines Arms. `armsRead` entscheidet alpha* (2 -> 0,0083, 1 -> 0,0167) und wird
 * vom Aufrufer aus dem Lese-Plan uebergeben, nicht hier geraten.
 */
function readArm(opts) {
  const { entries, alphaStar, beta, B, seed } = opts;
  const anzahlB = B || B_DEFAULT;
  const pe = pointEstimate(entries);
  const bloecke = new Set(entries.map((e) => String(e.block))).size;
  const censored = entries.filter((e) => e.outcome === 'CENSORED').length;
  const basis = {
    theta: pe.theta, pC: pe.pC, pW: pe.pW, nC: pe.nC, nW: pe.nW,
    resolved: entries.length, censored, blocks: bloecke,
    scheme: bloecke < WILD_MAX_BLOCKS ? 'wild-cluster-webb' : 'cluster-bootstrap',
    alphaStar, beta, B: anzahlB, seed: seed === undefined ? SEED_DEFAULT : seed,
    pFloor: 1 / anzahlB,
    firmNesting: assertFirmNesting(entries),
  };
  if (pe.theta === null || bloecke === 0) {
    return Object.assign(basis, { sdBoot: null, L: null, MDE: null, readable: false, reason: 'no-contrast' });
  }
  const infl = influences(entries, pe);
  const sums = blockSums(entries, infl);
  const wuerfel = rng(basis.seed);
  const zieh = [];
  if (basis.scheme === 'wild-cluster-webb') {
    for (let r = 0; r < anzahlB; r++) {
      let s = 0;
      for (const bs of sums) s += WEBB[Math.floor(wuerfel() * 6)] * bs;
      zieh.push(pe.theta + s);
    }
  } else {
    // Gewoehnlicher Cluster-Bootstrap: Bloecke mit Zuruecklegen ziehen.
    for (let r = 0; r < anzahlB; r++) {
      let s = 0;
      for (let i = 0; i < sums.length; i++) s += sums[Math.floor(wuerfel() * sums.length)];
      zieh.push(pe.theta + s);
    }
  }
  const m = zieh.reduce((a, b) => a + b, 0) / zieh.length;
  const sd = Math.sqrt(zieh.reduce((a, b) => a + (b - m) * (b - m), 0) / (zieh.length - 1));
  const zAlpha = probit(1 - alphaStar);
  const zBeta = probit(1 - beta);
  const ergebnis = Object.assign(basis, {
    sdBoot: sd,
    L: pe.theta - zAlpha * sd,
    MDE: (zAlpha + zBeta) * sd,
    readable: true, reason: null,
  });
  // Nie eine nicht endliche Zahl veroeffentlichen (Hausregel; der Lese-Job schreibt das
  // Ergebnis in eine Datei, und JSON.stringify macht aus NaN ein stilles null).
  for (const feld of ['theta', 'sdBoot', 'L', 'MDE']) {
    if (!Number.isFinite(ergebnis[feld])) {
      throw new Error('[druckenmiller] Lesung: ' + feld + ' ist ' + ergebnis[feld]
        + ' - eine nicht endliche Zahl wird nicht veroeffentlicht.');
    }
  }
  return ergebnis;
}

/**
 * Die VORBEDINGUNGEN einer Lesung (Rat 9 Teil 2a, Bedingung 4). Der Lese-Job ruft das als
 * erstes: kollabieren die Arme auf der festen Stichprobe, oder passt die Zahl der Arme nicht
 * zum alpha* dieser Lesung, wird NICHT gewertet. Kein Default, keine Umgehung.
 */
function assertReadPreconditions(opts) {
  const { armsRead, sampleBars63, sampleBars126, thresholds, alphaStar, scoreboard } = opts;
  const sb = scoreboard || require('./scoreboard.js');
  const kollaps = sb.armCollapseCheck(sampleBars63 || [], sampleBars126 || [], thresholds);
  if (kollaps.blocksScoring) {
    throw new Error('[druckenmiller] Arm-Kollaps-Waechter: ' + kollaps.reason
      + ' (Median ' + kollaps.median63 + ' vs ' + kollaps.median126 + ', KS*sqrt(ne) '
      + (kollaps.ks.Dscaled === null ? 'n/a' : kollaps.ks.Dscaled.toFixed(2))
      + ') - es wird nicht gewertet, das Design geht zurueck an den Rat.');
  }
  const arme = sb.armsMatchAlphaStar(armsRead);
  if (!arme.ok) {
    throw new Error('[druckenmiller] die Zahl formal getrennter Arme (' + arme.arms + ') passt nicht '
      + 'zur registrierten Familie - alpha* waere ' + arme.alphaStar + '.');
  }
  if (Number.isFinite(alphaStar) && alphaStar !== arme.alphaStar) {
    throw new Error('[druckenmiller] alpha* dieser Lesung ist ' + alphaStar + ', die Armzahl '
      + arme.arms + ' verlangt ' + arme.alphaStar + '.');
  }
  return { armCollapse: kollaps, arms: arme };
}

module.exports = {
  B_DEFAULT, SEED_DEFAULT, WILD_MAX_BLOCKS, WEBB,
  rng, probit, pointEstimate, influences, blockSums, assertFirmNesting, readArm,
  assertReadPreconditions,
};
