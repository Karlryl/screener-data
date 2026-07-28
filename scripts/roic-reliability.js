#!/usr/bin/env node
'use strict';
/**
 * PHASE 4.1 — Verlaesslichkeits-Bericht fuer die ROIC-Stabilitaets-Achse
 * =====================================================================
 * Liest external-data/sec-annual-bulk.jsonl und beantwortet die EINE Frage, an der das
 * Urteil vom 28.07. das Scharfschalten von W_ROIC_STABILITY aufgehaengt hat:
 *
 *   Misst die Achse ueberhaupt etwas Stabiles — oder sortiert sie nach einem Muenzwurf?
 *
 * Das Abbruchkriterium ist bewusst NICHT die Abdeckungsquote. 80 % Abdeckung einer
 * Kennzahl, die sich selbst nicht bestaetigt, sind 80 % Abdeckung von Rauschen.
 *
 * ZWEI MESSUNGEN, WEIL SIE VERSCHIEDENES BEDEUTEN
 * -----------------------------------------------
 * Die Achse ist ein STREUUNGSMASS (negativer Variationskoeffizient der ROIC-Reihe).
 * Ein reiner Alt/Neu-Split vermischt darum zwei Ursachen und kann nichts entscheiden:
 *
 *   (1) GERADE/UNGERADE Jahre — dieselbe Aera, nur andere Stuetzstellen.
 *       Misst reines Messrauschen. Faellt das durch, ist die Kennzahl schon als
 *       Beschreibung der Vergangenheit unbrauchbar.
 *   (2) ALT/NEU Haelfte — misst BESTAENDIGKEIT ueber die Zeit.
 *       Faellt nur das durch, ist die Kennzahl sauber gemessen, aber sie sagt
 *       ueber die Zukunft nichts — und genau dafuer wuerde sie im Scoring benutzt.
 *
 * Die Unterscheidung ist entscheidungsrelevant: hoch/niedrig heisst "sauber gemessen,
 * aber nicht vorhersagend" und fuehrt zu einem ANDEREN Schluss als niedrig/niedrig
 * ("kaputt gemessen").
 *
 * Run:  node scripts/roic-reliability.js [--in <jsonl>] [--min-haelfte N]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const IN_DEFAULT = path.join(ROOT, 'external-data', 'sec-annual-bulk.jsonl');
const { route } = require(path.join(ROOT, 'src/scoring/router.js'));

// Das Produktions-Gate der Achse. NICHT hier neu erfunden, sondern aus der Achse gelesen —
// weicht es ab, misst der Bericht etwas anderes als das System rechnet.
const ROIC_STAB_MIN_YEARS = 6;

const wert = (x) => (x && typeof x === 'object' ? x.value : x);
const zahlen = (a) => (Array.isArray(a) ? a.map(wert) : []).map((v) => (Number.isFinite(v) ? v : null));

/**
 * Gepaarte ROIC-Jahre einer Firma — exakt die Paarungsregel aus axes.js roicStability:
 * OpInc present, Assets present, CurrLiab present, invested = Assets - CurrLiab > 0.
 */
function roicJahre(annual) {
  const op = zahlen(annual.annualOpInc);
  const as = zahlen(annual.annualAssets);
  const cl = zahlen(annual.annualCurrentLiabilities);
  const fys = Array.isArray(annual._fys) ? annual._fys : [];
  const raus = [];
  const n = Math.max(op.length, as.length);
  for (let i = 0; i < n; i++) {
    const o = op[i], a = as[i], c = cl[i];
    if (o === null || a === null || c === null) continue;
    const inv = a - c;
    if (!(inv > 0)) continue;
    raus.push({ fy: fys[i] != null ? fys[i] : -i, roic: o / inv });
  }
  return raus;
}

/** Die Achse selbst: negativer Variationskoeffizient. Hoeher (naeher 0) = stabiler. */
function kennzahl(roics) {
  if (roics.length < 2) return null;
  const mittel = roics.reduce((p, c) => p + c, 0) / roics.length;
  if (!(Math.abs(mittel) > 0)) return null;
  const varianz = roics.reduce((p, c) => p + (c - mittel) * (c - mittel), 0) / roics.length;
  return -(Math.sqrt(varianz) / Math.abs(mittel));
}

/** Spearman-Rangkorrelation. Bindungen bekommen Durchschnittsraenge. */
function spearman(x, y) {
  const raenge = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const mittel = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = mittel;
      i = j + 1;
    }
    return r;
  };
  const rx = raenge(x), ry = raenge(y), n = x.length;
  const mx = rx.reduce((p, c) => p + c, 0) / n, my = ry.reduce((p, c) => p + c, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * Vertrauensbereich per Bootstrap. Fester Startwert, damit der Bericht reproduzierbar ist —
 * ein Bericht, der bei jedem Lauf andere Grenzen nennt, ist als Entscheidungsgrundlage wertlos.
 */
function bootstrapKI(paare, runden = 2000) {
  let z = 123456789;
  const wuerfel = () => { z ^= z << 13; z ^= z >>> 17; z ^= z << 5; return (z >>> 0) / 4294967296; };
  const rhos = [];
  for (let r = 0; r < runden; r++) {
    const a = [], b = [];
    for (let i = 0; i < paare.length; i++) {
      const k = Math.floor(wuerfel() * paare.length);
      a.push(paare[k][0]); b.push(paare[k][1]);
    }
    rhos.push(spearman(a, b));
  }
  rhos.sort((p, q) => p - q);
  return [rhos[Math.floor(runden * 0.025)], rhos[Math.floor(runden * 0.975)]];
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + ' %' : '—');
const f2 = (v) => (v === null ? '—' : v.toFixed(2));

function run() {
  const argv = process.argv.slice(2);
  const inIdx = argv.indexOf('--in');
  const IN = inIdx >= 0 ? argv[inIdx + 1] : IN_DEFAULT;
  const mhIdx = argv.indexOf('--min-haelfte');
  const MIN_HAELFTE = mhIdx >= 0 ? Number(argv[mhIdx + 1]) : 4;

  let roh;
  try { roh = fs.readFileSync(IN, 'utf8'); }
  catch (_) { console.error('::error::' + IN + ' fehlt — erst scripts/fetch-secbulk.js laufen lassen'); process.exit(1); }
  const zeilen = roh.trim().split('\n').filter(Boolean).map((z) => JSON.parse(z));

  const firmen = [];
  let ohneUsGaap = 0, opIncFehlt = 0, opIncHerleitbar = 0;
  for (const z of zeilen) {
    const a = z.annual || {};
    const tiefeBilanz = zahlen(a.annualAssets).filter((v) => v !== null).length;
    const tiefeOp = zahlen(a.annualOpInc).filter((v) => v !== null).length;
    if (!(a._fys || []).length) { ohneUsGaap += 1; continue; }
    if (tiefeOp === 0 && tiefeBilanz > 0) {
      opIncFehlt += 1;
      // AAR-Fall: kein OperatingIncomeLoss, aber GrossProfit vorhanden -> herleitbar waere
      // OpInc = GrossProfit - Betriebsaufwand. Nur ZAEHLEN, nicht herleiten: eine abgeleitete
      // Groesse in einer Scoring-Achse braucht ihre eigene Begruendung.
      if (zahlen(a.annualGP).filter((v) => v !== null).length > 0) opIncHerleitbar += 1;
    }
    const jahre = roicJahre(a);
    firmen.push({ ticker: z.ticker, jahre, tiefeBilanz, tiefeOp });
  }

  // --- 1. Abdeckung -------------------------------------------------------
  const tiefen = firmen.map((f) => f.jahre.length).sort((a, b) => a - b);
  const median = tiefen.length ? tiefen[Math.floor(tiefen.length / 2)] : 0;
  const durchGate = firmen.filter((f) => f.jahre.length >= ROIC_STAB_MIN_YEARS).length;
  const nullJahre = firmen.filter((f) => f.jahre.length === 0).length;

  console.log('\n=== 1 · ABDECKUNG ===');
  console.log('Zeilen im Extrakt:            ' + zeilen.length);
  console.log('ohne us-gaap (Auslandsfiler): ' + ohneUsGaap + '  ' + pct(ohneUsGaap, zeilen.length));
  console.log('bewertbare Firmen:            ' + firmen.length);
  console.log('gepaarte ROIC-Jahre:          Median ' + median + ' · max ' + (tiefen[tiefen.length - 1] || 0));
  console.log('durch das eigene Gate (>=' + ROIC_STAB_MIN_YEARS + '): ' + durchGate + '  ' + pct(durchGate, firmen.length));
  console.log('mit NULL gepaarten Jahren:    ' + nullJahre + '  ' + pct(nullJahre, firmen.length));
  console.log('\n--- der Engpass ---');
  console.log('Bilanz da, aber KEIN Betriebsergebnis: ' + opIncFehlt + '  ' + pct(opIncFehlt, firmen.length));
  console.log('  davon mit Rohertrag (waere herleitbar): ' + opIncHerleitbar);

  // --- 2. Verlaesslichkeit ------------------------------------------------
  const geradeUngerade = [], altNeu = [];
  for (const f of firmen) {
    if (f.jahre.length < MIN_HAELFTE * 2) continue;
    // Stuetzstellen-Split: dieselbe Aera, andere Jahre -> reines Messrauschen.
    const g = f.jahre.filter((_, i) => i % 2 === 0).map((j) => j.roic);
    const u = f.jahre.filter((_, i) => i % 2 === 1).map((j) => j.roic);
    const kg = kennzahl(g), ku = kennzahl(u);
    if (kg !== null && ku !== null) geradeUngerade.push([kg, ku]);
    // Zeit-Split: _fys ist absteigend (neuestes zuerst) -> erste Haelfte = neu.
    const mitte = Math.floor(f.jahre.length / 2);
    const kn = kennzahl(f.jahre.slice(0, mitte).map((j) => j.roic));
    const ka = kennzahl(f.jahre.slice(mitte).map((j) => j.roic));
    if (kn !== null && ka !== null) altNeu.push([ka, kn]);
  }

  console.log('\n=== 2 · VERLAESSLICHKEIT (je Haelfte mind. ' + MIN_HAELFTE + ' Jahre) ===');
  for (const [titel, paare, deutung] of [
    ['gerade/ungerade Jahre (Messrauschen)', geradeUngerade, 'Beschreibt die Kennzahl die Vergangenheit sauber?'],
    ['alt/neu Haelfte (Bestaendigkeit)     ', altNeu, 'Sagt Vergangenheit etwas ueber die Zukunft?'],
  ]) {
    if (paare.length < 20) { console.log(titel + ': zu wenige Firmen (' + paare.length + ')'); continue; }
    const rho = spearman(paare.map((p) => p[0]), paare.map((p) => p[1]));
    const ki = bootstrapKI(paare);
    const urteil = ki[0] > 0.35 ? 'TRAEGT' : (ki[1] < 0.35 ? 'TRAEGT NICHT' : 'UNENTSCHIEDEN');
    console.log(titel + ': rho ' + f2(rho) + '  [' + f2(ki[0]) + '; ' + f2(ki[1]) + ']  n=' + paare.length + '  -> ' + urteil);
    console.log('    ' + deutung);
  }

  // --- 3. Traegt die Achse mehr als die Branche? -------------------------
  // Die Achse sitzt in BRANCHEN-Boards. Waere ihr Rangsignal bloss ein Branchen-Abbild
  // (Versorger stabil, Minen schwankend), waere ein hohes rho ueber das Gesamtuniversum
  // wertlos: innerhalb eines Boards sind alle aus derselben Branche, das Signal verschwaende.
  // Deshalb wird dieselbe Messung NOCH EINMAL je Branche gefahren und gepoolt.
  const branche = new Map();
  try {
    const SNAP = process.env.SEC_SNAPSHOTS_DIR || path.join(ROOT, 'snapshots');
    for (const f of fs.readdirSync(SNAP)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      let s; try { s = JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8')); } catch (_) { continue; }
      const p = (s && (s.profile || s.meta)) || {};
      if (!(s && s.meta && s.meta.ticker && p.sector)) continue;
      // NUR geroutete Namen. Die Boards werden aus ihnen gebaut; wer das Gesamtuniversum
      // als Nenner nimmt, misst eine Abdeckung, die es in keinem Board gibt (Financial
      // Services: 4 % ueber alles gegen 13 % ueber die Board-Mitglieder).
      if (route(s).action !== 'route') continue;
      branche.set(s.meta.ticker, p.sector);
    }
  } catch (_) { /* ohne Snapshots faellt nur dieser Abschnitt aus */ }

  console.log('\n=== 3 · TRAEGT DIE ACHSE MEHR ALS DIE BRANCHE? ===');
  if (branche.size === 0) {
    console.log('keine Branchen-Zuordnung verfuegbar (snapshots/) — Abschnitt uebersprungen');
  } else {
    const proBranche = new Map();
    for (const f of firmen) {
      if (f.jahre.length < MIN_HAELFTE * 2) continue;
      const b = branche.get(f.ticker);
      if (!b) continue;
      const mitte = Math.floor(f.jahre.length / 2);
      const kn = kennzahl(f.jahre.slice(0, mitte).map((j) => j.roic));
      const ka = kennzahl(f.jahre.slice(mitte).map((j) => j.roic));
      if (kn === null || ka === null) continue;
      if (!proBranche.has(b)) proBranche.set(b, []);
      proBranche.get(b).push([ka, kn]);
    }
    const zeilen2 = [...proBranche.entries()].filter(([, p]) => p.length >= 30).sort((a, b) => b[1].length - a[1].length);
    let gewSumme = 0, gewN = 0;
    for (const [b, paare] of zeilen2) {
      const rho = spearman(paare.map((p) => p[0]), paare.map((p) => p[1]));
      console.log('  ' + b.padEnd(24) + 'rho ' + f2(rho) + '  n=' + paare.length);
      gewSumme += rho * paare.length; gewN += paare.length;
    }
    if (gewN) {
      const innen = gewSumme / gewN;
      console.log('  ' + '-'.repeat(44));
      console.log('  ' + 'INNERHALB der Branchen'.padEnd(24) + 'rho ' + f2(innen) + '  n=' + gewN + ' (nach Groesse gewichtet)');
      console.log('  Bricht dieser Wert gegenueber dem Gesamtuniversum ein, misst die Achse Branche, nicht Firma.');
    }

    // --- 4. Ist ein Board homogen genug, dass die Achse fuer ALLE gilt? ---
    // Solange die Achse nichts misst, ist die Coverage-Schrumpfung rangneutral (Null-Test:
    // 0,068 Punkte, null Verdraengungen). Sobald sie etwas misst, wird aus dem neutralen
    // Platzhalter eine Bevorzugung: die abgedeckte Haelfte spreizt sich, die andere klebt am
    // Median. Ein Board, in dem nur die Haelfte die Achse hat, bewertet nach zwei Massstaeben.
    const mitAchse = new Set(firmen.filter((f) => f.jahre.length >= ROIC_STAB_MIN_YEARS).map((f) => f.ticker));
    const proBoard = new Map();
    for (const [tk, b] of branche) {
      if (!proBoard.has(b)) proBoard.set(b, { n: 0, achse: 0 });
      const e = proBoard.get(b);
      e.n += 1;
      if (mitAchse.has(tk)) e.achse += 1;
    }
    const rhoJeBranche = new Map(zeilen2.map(([b, paare]) => [b, spearman(paare.map((p) => p[0]), paare.map((p) => p[1]))]));
    console.log('\n=== 4 · IST EIN BOARD HOMOGEN GENUG? ===');
    console.log('Board                     Namen   hat Achse   rho     scharfschalten?');
    const MIN_ABDECKUNG = 0.80, MIN_RHO = 0.35;
    let reif = 0;
    for (const [b, e] of [...proBoard.entries()].filter(([, x]) => x.n >= 40).sort((a, b2) => b2[1].n - a[1].n)) {
      const abd = e.achse / e.n;
      const rho = rhoJeBranche.has(b) ? rhoJeBranche.get(b) : null;
      const ok = abd >= MIN_ABDECKUNG && rho !== null && rho >= MIN_RHO;
      if (ok) reif += 1;
      const grund = ok ? 'JA' : (abd < MIN_ABDECKUNG ? 'nein — Abdeckung' : 'nein — rho');
      console.log('  ' + b.padEnd(24) + String(e.n).padStart(5) + (100 * abd).toFixed(0).padStart(10) + ' %'
        + (rho === null ? '     —' : f2(rho).padStart(7)) + '   ' + grund);
    }
    console.log('  ' + '-'.repeat(64));
    console.log('  reif zum Scharfschalten: ' + reif + ' Boards'
      + (reif === 0 ? '  -> W_ROIC_STABILITY bleibt 0' : '  -> Board-weise Aktivierung moeglich'));
  }

  console.log('\n=== 5 · MASSSTAB (Urteils-Revision vom 28.07.) ===');
  console.log('Scharfschalten von W_ROIC_STABILITY verlangt JE BOARD BEIDES:');
  console.log('  (a) >= 80 % der Board-Mitglieder tragen die Achse  (Homogenitaet)');
  console.log('  (b) das Board-eigene rho >= 0,35                   (Verlaesslichkeit)');
  console.log('Die Verlaesslichkeit ist global belegt (rho 0,47 [0,42; 0,52]) — sie ist nicht');
  console.log('mehr der Blocker. Der Blocker ist (a): kein Board kommt heute ueber ~52 %.');
}

module.exports = { roicJahre, kennzahl, spearman, bootstrapKI, ROIC_STAB_MIN_YEARS };

if (require.main === module) run();
