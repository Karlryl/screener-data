'use strict';
/**
 * scripts/rank-ic.js — Auswertung der 2.3-Vintage-Messreihe nach der
 * pre-registrierten 2.8-MESS-FUNDAMENT-Spezifikation (Formel-Ledger §1–§4, §8)
 * und der pre-registrierten Erfolgsschwelle (Ledger-Kapitel „2.3 PRE-REGISTRIERTE
 * rankIC-ERFOLGSSCHWELLE", eingefroren 2026-07-14, VOR Vintage #1).
 *
 *  §1  Entscheidungs-IC NUR auf disjunkten 84-KALENDERTAGE-Quartalsfenstern
 *      (erstes Vintage = t0; nächster Entscheidungspunkt = erstes Vintage >= t0+84d …).
 *      Die tägliche (überlappende) Reihe als Newey-West-Diagnose ist NOCH NICHT
 *      implementiert — offener Diagnose-Pfad (§2b). Der Code hat bisher nur den
 *      disjunkten Pfad (§1/§2 unten); M5-Fund 2026-07-17: Kopf behauptete faelschlich
 *      im Praesens, die taegliche Reihe liefe bereits.
 *  §2  Block-Bootstrap-CI (Blocklänge BOOTSTRAP_BLOCK_LEN=2, B=10.000, BCa-Perzentil;
 *      zirkuläres Resampling zusammenhängender Blöcke statt IID-Punkte, da benachbarte
 *      Fenster über Preishistorie/Regime autokorreliert sind — BH-148) für den mittleren
 *      IC; N_eff aus der Lag-1-Autokorrelation der Punkt-Reihe (§3a).
 *  §3  Entscheidung: CI-Untergrenze(90 %) > 0 UND mittlerer 84d-IC > 0,05
 *      (UND-Regel roh+residualisiert, §4a, JEWEILS mit eigener Power/N_eff); Benjamini-
 *      YEKUTIELI-FDR über die VOLLE Familie Boards × {28d, 84d} (nicht nur die gerade
 *      messbaren/gepowerten Punkte — sonst schrumpft m und die Schwelle wird liberaler,
 *      BH-107; nicht (aus)messbare Tests zählen mit p=1); §3d Mindest-Power: N_eff < 8
 *      => „unterpowert — KEIN Urteil" (weder LIVE-Bestätigung noch Cut).
 *  §4a Doppel-Report: roher Spearman-rankIC UND SEMI-PARTIAL residualisierter IC (nur
 *      die Forward-Returns werden cross-sectional gegen die PIT-Kontrollen
 *      beta/evSales/priceGrossProfit[/log-marketCap, sobald eingefroren] regressiert;
 *      der Score-Rang bleibt ROH — keine volle Partial-Korrelation, BH-151) — Rang-
 *      basierte OLS auf present-Kontrollen; fehlende Kontrolle => Zeile bleibt im
 *      ROHEN IC, fällt aus dem residualisierten (Ausweis).
 *  §4b Delivery-IC (preisfrei): Score(t0) vs realisiertes Umsatz-Delta t0+2Q,
 *      aus den PIT-Quartalsserien ZWEIER Vintages (forward-only; braucht ein
 *      Vintage >= t0+180d — bis dahin ehrlich „noch nicht scharf").
 *  §8  Austritts-Behandlung via lib/forward-returns.classify():
 *      'delisted'      -> Forward-Return −100 % (bleibt in der Stichprobe);
 *      'series_ended'  -> Fenster auf letzten verfügbaren Tag VERKÜRZEN (newestDate),
 *                         mit Ausweis der verkürzten Haltedauer (deckt den M&A-Fall:
 *                         letzter gehandelter Kurs ≈ Angebotspreis, nie gedroppt);
 *                         kein Kurs am Fensterstart -> Ausschluss mit Quote.
 *      Austrittsquote je Board×Vintage wird protokolliert (hohe Quote = Warnung).
 *  Exclude: board-history/_excluded.json — der vom Writer (write-board-history.js)
 *      angelegte Vertrag {_doc, excluded:[{date,board,reason}]} UND (als Union, nicht
 *      als Alternative — 'excluded' existiert auf der echten Datei immer) die Altformate:
 *      Top-Level-Datumsschlüssel {"YYYY-MM-DD":"grund"} in derselben Datei sowie eine
 *      blanke Liste von Datums-Strings als ganzer Dateiinhalt. Eintrag OHNE board =
 *      Datum global aus; MIT board = nur dieses Board an diesem Datum. Exkludiertes
 *      fällt nachweislich aus JEDER Rechnung (Ausweis im Report). Ein vorhandenes
 *      'excluded', das KEIN Array ist, ist ein harter Fehler (kein stiller No-Op).
 *
 * Usage: node scripts/rank-ic.js [--history-dir board-history] [--out outputs/rank-ic-report.json]
 * Exit 0 = Report geschrieben (auch „keine auswertbaren Fenster" ist ein gültiger Report).
 * Exit 1 = KEIN Report: leerer/fehlender Preis-Index (loadPriceIndexOrThrow, Tag 321) —
 *          bewusst fail-loud. Ein IC ohne Preise waere kein Negativergebnis, sondern
 *          ein stiller Messausfall, der wie „kein Signal" aussieht.
 */
const fs = require('fs');
const path = require('path');
const store = require('../lib/price-history-store.js');
const { classify } = require('../lib/forward-returns.js');
const { buildPriceIndex } = require('./walk-forward-perf.js');

const REPO_ROOT = path.resolve(__dirname, '..');

// ── pre-registrierte Konstanten (Ledger-Kapitel, eingefroren 2026-07-14) ─────
const HORIZONS = [28, 84];            // Kalendertage (§3c-Familie: Boards × Horizonte)
const DECISION_HORIZON = 84;          // Entscheidungs-Horizont (§1)
const IC_THRESHOLD_84 = 0.05;         // Ledger: mittlerer 84d-rankIC > 0,05
const IC_GUIDE_28 = 0.03;             // Ledger: 28d-Richtwert (sekundär, nicht entscheidend)
const CI_LEVEL = 0.90;                // Ledger: Block-Bootstrap-90 %-CI
const BOOTSTRAP_B = 10000;            // §2 (BH-148: Ledger verlangt B=10.000, war 2000)
const BOOTSTRAP_BLOCK_LEN = 2;        // §2 (BH-148: Ledger-Blocklänge für Block-Bootstrap)
const MIN_NEFF = 8;                   // §3d Mindest-Power
const BY_Q = 0.10;                    // §3b Benjamini-Yekutieli-FDR-Niveau
// MDE (Minimum Detectable Effect) je Board/Horizont, Pflicht-Ausweis (BH-158):
// MDE = MDE_Z * SE(mean IC), SE aus der N_eff-adjustierten Streuung der Fenster-IC-Punkte.
// MDE_Z = z(1-alpha) + z(power) für einseitig alpha=0,05 (Ledger CI90-lo>0) und Power 80 %
// (1,645 + 0,842 ≈ 2,487) — reiner Ausweis, kein zusätzliches Verdict-Kriterium.
const MDE_Z = 2.487;
const DELIVERY_MIN_GAP_DAYS = 180;    // §4b: t0+2Q (A12-Kopplung), zugleich Zielband-Zentrum des Delivery-Quartals
const DELIVERY_BAND_TOL_DAYS = 30;    // §4b: akzeptiertes Fenster ±30d um +2Q -> [end0+150d, end0+210d]

// ── kleine Statistik-Helfer (pur, testbar) ───────────────────────────────────
function ranks(values) {
  // Durchschnittsränge bei Ties (Spearman-Standard).
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}
function spearman(xs, ys) { return pearson(ranks(xs), ranks(ys)); }
function stddev(values) {
  const n = values.length;
  if (n < 2) return null;
  const m = values.reduce((s, v) => s + v, 0) / n;
  const ss = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(ss / (n - 1));
}
// Standardnormal-CDF/-Inverse (BH-148, BCa-Perzentil) — kein stdlib/Dependency für Statistik
// vorhanden, daher Standard-Näherungen (Abramowitz&Stegun 7.1.26 / Acklam), reine Funktionen.
function erf(x) {
  const sign = x < 0 ? -1 : 1; const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normalCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
function invNormalCdf(pr) {
  // Peter Acklam's rationale Näherung der inversen Standardnormal-CDF.
  if (pr <= 0) return -Infinity;
  if (pr >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (pr < plow) {
    q = Math.sqrt(-2 * Math.log(pr));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (pr <= phigh) {
    q = pr - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - pr));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// Rang-basierte multiple OLS-Residualisierung (§4a): y-Ränge gegen Kontroll-Ränge
// (Gauß-Elimination, kleine k). Liefert Residuen; bei Degeneration null.
function residualize(y, controls /* Array von Arrays gleicher Länge */) {
  const n = y.length, k = controls.length;
  if (k === 0) return y.slice();
  // Design-Matrix mit Intercept, alles auf Rängen (robust gegen Ausreißer).
  const yr = ranks(y);
  const X = [new Array(n).fill(1)].concat(controls.map(ranks));
  const p = X.length;
  // Normalgleichungen (X'X) b = X'y
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < p; b++) { let s = 0; for (let i = 0; i < n; i++) s += X[a][i] * X[b][i]; XtX[a][b] = s; }
    let s = 0; for (let i = 0; i < n; i++) s += X[a][i] * yr[i]; Xty[a] = s;
  }
  // Gauß mit Partial-Pivot
  const A = XtX.map((row, i) => row.concat([Xty[i]]));
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null; // kollinear/degeneriert
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= p; c++) A[r][c] -= f * A[col][c];
    }
  }
  const beta = A.map((row, i) => row[p] / A[i][i]);
  const resid = new Array(n);
  for (let i = 0; i < n; i++) {
    let fit = 0; for (let a = 0; a < p; a++) fit += beta[a] * X[a][i];
    resid[i] = yr[i] - fit;
  }
  return resid;
}

// §2: Block-Bootstrap-CI des Mittelwerts über die disjunkten Punkte (deterministisch via
// LCG-Seed, damit Läufe reproduzierbar sind).
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// BH-148: zieht zusammenhängende Blöcke der Länge blockLen (zirkulär über die Punkt-Reihe)
// statt einzelner Punkte — die disjunkten Fenster-IC-Punkte sind eine Zeitreihe (gemeinsame
// Preishistorie/Regime zwischen benachbarten Fenstern), IID-Resampling einzelner Punkte
// unterschätzt die wahre Varianz systematisch.
function blockResample(points, rnd, blockLen) {
  const n = points.length;
  const out = new Array(n);
  let filled = 0;
  while (filled < n) {
    const start = Math.floor(rnd() * n);
    for (let k = 0; k < blockLen && filled < n; k++) out[filled++] = points[(start + k) % n];
  }
  return out;
}
// BH-148: BCa (bias-corrected and accelerated) Perzentil-Intervall statt naivem Perzentil —
// korrigiert Bias (z0, aus dem Anteil Bootstrap-Mittel < Original-Mittel) und Schiefe
// (Akzeleration a, aus dem Jackknife über die Original-Punkte). Degeneriert robust auf ein
// reines Bias-korrigiertes Intervall (a=0), wenn zu wenige Punkte für eine Jackknife-Schätzung
// da sind oder die Akzeleration nicht bestimmbar ist (nie NaN/Crash).
function bcaInterval(points, means, mean0, level) {
  const B = means.length;
  const sorted = means.slice().sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(B - 1, Math.max(0, Math.round(p * (B - 1))))];
  let below = 0; for (const m of means) if (m < mean0) below++;
  const propBelow = Math.min(1 - 1e-9, Math.max(1e-9, below / B));
  const z0 = invNormalCdf(propBelow);
  const n = points.length;
  let a = 0;
  if (n >= 2) {
    const jackMeans = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0; for (let j = 0; j < n; j++) if (j !== i) s += points[j];
      jackMeans[i] = s / (n - 1);
    }
    const jackMean = jackMeans.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { const d = jackMean - jackMeans[i]; num += d ** 3; den += d ** 2; }
    if (den > 0) a = num / (6 * Math.pow(den, 1.5));
  }
  const alpha = (1 - level) / 2;
  const adjust = (z) => {
    const zz = z0 + z;
    const denom = 1 - a * zz;
    const p = (!Number.isFinite(denom) || Math.abs(denom) < 1e-9) ? normalCdf(zz) : normalCdf(z0 + zz / denom);
    return Number.isFinite(p) ? Math.min(1 - 1e-9, Math.max(1e-9, p)) : normalCdf(zz);
  };
  return { lo: at(adjust(invNormalCdf(alpha))), hi: at(adjust(invNormalCdf(1 - alpha))) };
}
function bootstrapCI(points, level, B, seed, blockLen) {
  const n = points.length;
  if (n === 0) return null;
  const bl = Math.max(1, Math.min(blockLen || BOOTSTRAP_BLOCK_LEN, n));
  const rnd = lcg(seed);
  const mean0 = points.reduce((s, v) => s + v, 0) / n;
  const means = new Array(B);
  for (let b = 0; b < B; b++) {
    const sample = blockResample(points, rnd, bl);
    let s = 0; for (let i = 0; i < n; i++) s += sample[i];
    means[b] = s / n;
  }
  // p-Wert (einseitig, H0: mean<=0): Anteil Bootstrap-Mittel <= 0, min 1/B (nie exakt 0).
  const pLeq0 = Math.max(1 / B, means.filter((m) => m <= 0).length / B);
  const { lo, hi } = bcaInterval(points, means, mean0, level);
  return { lo, hi, p: pLeq0 };
}
// §3a: N_eff aus Lag-1-Autokorrelation der Punkt-Reihe (konservativ geklemmt).
function nEff(points) {
  const n = points.length;
  if (n < 3) return n;
  const rho = pearson(points.slice(0, -1), points.slice(1));
  if (rho === null || rho <= 0) return n;
  return Math.max(1, n * (1 - rho) / (1 + rho));
}
// §3b Benjamini-Yekutieli: adjustierte Signifikanz über m Tests.
function benjaminiYekutieli(pvals, q) {
  const m = pvals.length;
  if (!m) return [];
  const cm = Array.from({ length: m }, (_, i) => 1 / (i + 1)).reduce((s, v) => s + v, 0);
  const order = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  let maxK = -1;
  for (let k = 0; k < m; k++) if (order[k][0] <= ((k + 1) / (m * cm)) * q) maxK = k;
  const sig = new Array(m).fill(false);
  for (let k = 0; k <= maxK; k++) sig[order[k][1]] = true;
  return sig;
}

// ── Vintage-Laden + §1-Fenster ───────────────────────────────────────────────
// R-Gate 2.R Fund R2.5: der Writer (write-board-history.js readOrScaffoldExcluded)
// legt {_doc, excluded:[{date,board,reason}]} an und dokumentiert im _doc, dass rank-ic
// diese Liste konsumiert. Gelesen wurden aber nur die Altformate — die Schlüssel des
// Writer-Blocks ('_doc','excluded') fielen durch den Datums-Regex und die Map blieb LEER:
// ein per Audit eingetragener Ausschluss war ein stiller No-Op, das als korrupt erkannte
// Vintage blieb in JEDER Rechnung.
//
// R-Gate 2.R Runde 3 (Funde #4+#6): der Tag-324-Fix stieg beim ersten gefundenen Format
// SOFORT aus. Auf der ECHTEN Datei ist 'excluded' aber IMMER vorhanden (das Writer-Gerüst
// legt {_doc, excluded: []} an) — der Altformat-Zweig war damit tot, und ein daneben
// eingetragener Top-Level-Datumsschlüssel wurde erneut still geschluckt: derselbe Fehler,
// nur eine Ebene tiefer. Jetzt UNION statt Frühausstieg: beide Quellen werden gelesen
// (der Datums-Regex ignoriert '_doc'/'excluded' ohnehin). Und ein 'excluded', das existiert
// aber KEIN Array ist (Tippfehler, Objekt statt Liste), ist ab jetzt ein harter Fehler —
// analog loadPriceIndexOrThrow: die Messreihe darf nie wieder still nichts ausschliessen,
// wo ein Audit einen Ausschluss eingetragen hat.
//
// Rückgabe: Map<date, {reason, boards}> — boards === null heisst „Datum global aus",
// sonst Map<board,reason> = nur diese Boards an diesem Datum aus (global schlägt board-eng).
function loadExcluded(historyDir) {
  const f = path.join(historyDir, '_excluded.json');
  // BH-104: „Datei fehlt" (noch nichts geschrieben, normal vor dem ersten Writer-Lauf) und
  // „Datei da, aber kaputt" (Parse-Fehler) wurden bisher gleich behandelt — beide lieferten
  // eine leere Map, still, ohne Unterschied. Ein per Audit eingetragener Ausschluss in einer
  // anschließend beschädigten Datei wäre so lautlos wirkungslos geworden UND jeder Rechnung
  // hätte das wie „keine Ausschlüsse" ausgesehen. Fehlen bleibt harmlos (leere Map); ein
  // Parse-Fehler auf einer VORHANDENEN Datei ist jetzt fail-loud, analog zum
  // "excluded"-nicht-Array-Fehler unten.
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (_) { return new Map(); }
  let raw;
  try { raw = JSON.parse(text); }
  catch (e) {
    throw new Error(
      '[rank-ic] ' + f + ': JSON kaputt (' + e.message + '). Eine vorhandene, aber unlesbare '
      + 'Ausschlussliste als leer zu behandeln würde eingetragene Ausschlüsse lautlos verlieren.',
    );
  }
  const out = new Map();
  const add = (date, board, reason) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date == null ? '' : date))) return;
    let e = out.get(date);
    if (!e) { e = { reason, boards: new Map() }; out.set(date, e); }
    if (e.boards === null) return;                                  // schon global aus
    if (!board) { e.boards = null; e.reason = reason; return; }     // ohne board = global
    e.boards.set(String(board), reason);
  };
  const isObj = raw && typeof raw === 'object' && !Array.isArray(raw);
  // fail-loud: 'excluded' da, aber keine Liste -> die Einträge wären unlesbar und
  // der Ausschluss ein stiller No-Op. Lieber lauter Abbruch als falsche Messreihe.
  if (isObj && 'excluded' in raw && !Array.isArray(raw.excluded)) {
    throw new Error(
      '[rank-ic] ' + f + ': Feld "excluded" ist ' + (raw.excluded === null ? 'null' : typeof raw.excluded)
      + ', erwartet wird eine LISTE (Writer-Vertrag {_doc, excluded:[{date,board,reason}]}). '
      + 'Ein nicht lesbares Ausschluss-Feld würde still nichts ausschliessen — als korrupt '
      + 'erkannte Vintages blieben in jeder Rechnung.',
    );
  }
  // (1) Writer-Vertrag {excluded:[…]} und (2) blanke Liste — Einträge dürfen
  //     Datums-String ODER {date,board,reason} sein.
  const entries = Array.isArray(raw) ? raw : (isObj && Array.isArray(raw.excluded) ? raw.excluded : []);
  for (const e of entries) {
    if (typeof e === 'string') add(e, null, 'excluded');
    else if (e && typeof e === 'object') add(e.date, e.board || null, e.reason || 'excluded');
  }
  // (3) Altformat {"YYYY-MM-DD": "grund"} — als UNION, nicht als Alternative: auf der
  //     echten Datei existiert 'excluded' immer, ein Alternativ-Zweig wäre tot.
  if (isObj) {
    for (const [k, v] of Object.entries(raw)) add(k, null, typeof v === 'string' ? v : 'excluded');
  }
  return out;
}
// Datum global aus (fällt aus der Vintage-Reihe aller Boards).
function isDateExcluded(excluded, date) {
  const e = excluded.get(date);
  return !!e && e.boards === null;
}
// Datum für DIESES Board aus (global oder board-eng).
function isBoardExcluded(excluded, date, board) {
  const e = excluded.get(date);
  return !!e && (e.boards === null || e.boards.has(board));
}
function listVintageDates(historyDir) {
  let entries = [];
  try { entries = fs.readdirSync(historyDir); } catch (_) { return []; }
  return entries.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}
function loadVintage(historyDir, date, board) {
  const fp = path.join(historyDir, date, board + '.json');
  // BH-110: „Datei fehlt" (Board existiert an diesem Tag schlicht nicht) und „Datei da, aber
  // kaputtes JSON" (Parse-Fehler) landeten beide gleich als null → der Aufrufer verwirft
  // still per `continue` — ein defekter Entscheidungspunkt sah aus wie „kein Board an diesem
  // Tag", statt als Messausfall aufzufallen. Fehlen bleibt harmlos (null, kein Fehler); ein
  // Parse-Fehler auf einer VORHANDENEN Datei ist jetzt fail-loud (analog loadExcluded/
  // loadPriceIndexOrThrow).
  let text;
  try { text = fs.readFileSync(fp, 'utf8'); } catch (_) { return null; }
  let v;
  try { v = JSON.parse(text); }
  catch (e) {
    throw new Error('[rank-ic] ' + fp + ': JSON kaputt (' + e.message + ') — ein verworfener '
      + 'Entscheidungspunkt wäre ein stiller Messausfall, kein "Board fehlt an diesem Tag".');
  }
  // BH-103: compact() (write-board-history.js) strippt den per-Zeile-pit-Block aus Vintages
  // älter als RETENTION_DAYS und archiviert den Voll-Snapshot unter v.archivedTo (repo-
  // relativ). Der Delivery-IC (§4b) braucht t0.pit genau an dem 180d-Punkt, an dem Retention
  // und Delivery-Horizont zusammenfallen — ohne diesen Fallback fiele deliveryIC.n genau dann
  // still auf 0, wenn das Fenster scharf würde. Archiv-Kopie transparent statt der gestrippten
  // Kern-Version lesen, wenn vorhanden; sonst bleibt die gestrippte Version (Status quo).
  if (v && v.compacted && v.archivedTo) {
    let archived = null;
    try { archived = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, v.archivedTo), 'utf8')); }
    catch (_) { /* Archiv fehlt/kaputt -> bei der gestrippten Kern-Version bleiben, kein Fehler */ }
    if (archived && archived.cohort) return archived;
  }
  return v;
}
function boardsOf(historyDir, date) {
  // Board = Datei mit cohort-Objekt. Der Vintage-Ordner trägt auch Sidecars
  // (calibration.json, regime.json — write-board-history legt sie daneben);
  // namensbasiertes Filtern bricht beim nächsten Sidecar wieder, also inhaltsbasiert.
  // BH-110: NUR das readdirSync (Ordner fehlt = Tag existiert nicht, harmlos) fängt hier ab.
  // Ein Parse-Fehler aus loadVintage() darf NICHT hier verschluckt werden — sonst würde der
  // fail-loud-Fix oben durch ein äußeres try/catch wieder zu einem stillen [] degradiert.
  let files;
  try { files = fs.readdirSync(path.join(historyDir, date)); } catch (_) { return []; }
  return files
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((b) => { const v = loadVintage(historyDir, date, b); return !!(v && v.cohort); });
}
// §1: disjunkte Entscheidungspunkte — erstes Vintage, dann jeweils das erste
// Vintage >= letzter Punkt + horizonDays.
function disjointDecisionDates(dates, horizonDays) {
  const out = [];
  let nextOk = null;
  for (const d of dates) {
    if (nextOk === null || d >= nextOk) {
      out.push(d);
      const t = new Date(d + 'T00:00:00Z');
      t.setUTCDate(t.getUTCDate() + horizonDays);
      nextOk = t.toISOString().slice(0, 10);
    }
  }
  return out;
}

const addDaysIso = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// newestPriceDate — letzter Kurstag als Reife-Anker (§1).
// R-Gate 2.R Fund F5-2: Liegt das Fensterende hinter diesem Tag, ist das Fenster
// schlicht NICHT ABGELAUFEN. Ohne diesen Anker greift der §8-M&A-Verkürzungspfad
// (gedacht für echte Austritte) für die ganze Kohorte und bucht eine 3-Tage-Rendite
// als vollwertigen 84d-Punkt — die pre-registrierte Haltedauer wäre gebrochen.
// BH-149: der GLOBALE Max über ALLE Ticker lässt einen einzigen kaputten/zukunftsdatierten
// Bar (irgendein Kleinst-Ticker) die GESAMTE Kohorte vorzeitig reifen. Bindet stattdessen an
// einen kanonischen Benchmark-Ticker (dieselbe Kandidaten-Reihenfolge wie walk-forward-perf.js
// computeBenchmarkReturn: SPY→QQQ→IWM) — dessen Serie kann nicht durch einen einzelnen
// Kleinst-Ticker-Ausreisser verzerrt werden. Fehlt jeder Kandidat im Index (z. B. eine
// Test-Fixture ohne Benchmark), fällt der Anker auf den alten globalen Max zurück
// (Rückwärtskompatibilität dort, wo kein Benchmark verfügbar ist).
const BENCHMARK_CANDIDATES = ['SPY', 'QQQ', 'IWM']; // Reihenfolge wie walk-forward-perf.js
function newestPriceDate(priceIndex) {
  for (const t of BENCHMARK_CANDIDATES) {
    const map = priceIndex[t];
    if (!map || typeof map.keys !== 'function') continue;
    let newest = null;
    for (const d of map.keys()) if (!newest || d > newest) newest = d;
    if (newest) return newest;
  }
  let newest = null;
  for (const map of Object.values(priceIndex)) {
    if (!map || typeof map.keys !== 'function') continue;
    for (const d of map.keys()) if (!newest || d > newest) newest = d;
  }
  return newest;
}

// ── Forward-Returns je Vintage-Kohorte (§8) ──────────────────────────────────
function windowReturns(priceIndex, rows, t0, horizonDays) {
  const t1 = addDaysIso(t0, horizonDays);
  const used = []; const quota = { ok: 0, delisted: 0, shortened: 0, excluded_no_series: 0, excluded_no_entry: 0 };
  for (const r of rows) {
    if (!Number.isFinite(r.score)) continue; // survival-Zeilen ohne Score bleiben draußen
    const c = classify(priceIndex, r.ticker, t0, t1);
    if (c.status === 'ok') { used.push({ row: r, ret: c.ret, shortened: false }); quota.ok++; continue; }
    if (c.status === 'delisted') { used.push({ row: r, ret: -1.0, shortened: false }); quota.delisted++; continue; } // §8: Totalverlust, NIE droppen
    if (c.status === 'series_ended' && c.newestDate && c.newestDate > t0) {
      // §8-M&A-Pfad: Fenster auf letzten verfügbaren Tag verkürzen (Angebotspreis-Nähe).
      const c2 = classify(priceIndex, r.ticker, t0, c.newestDate);
      if (c2.status === 'ok') { used.push({ row: r, ret: c2.ret, shortened: true, heldUntil: c.newestDate }); quota.shortened++; continue; }
      quota.excluded_no_series++; continue;
    }
    if (c.status === 'series_ended') { quota.excluded_no_series++; continue; }
    quota.excluded_no_entry++; // no_series / no_entry_price
  }
  const denom = used.length + quota.excluded_no_series + quota.excluded_no_entry;
  // R-Gate 2.R Fund R2.12: exitRate zählt excluded_no_entry im NENNER, nie im Zähler —
  // eine Kohorte ohne einen einzigen Einstiegskurs meldet damit exitRate 0.000 ("sauber"),
  // während 100 % der Stichprobe weg sind. exitRate bleibt wie gemeint (echte Austritte);
  // daneben tritt unusableRate als eigene Kennzahl für den blinden Fleck.
  return {
    used,
    quota,
    exitRate: denom ? (quota.delisted + quota.shortened + quota.excluded_no_series) / denom : 0,
    unusableRate: denom ? (quota.excluded_no_series + quota.excluded_no_entry) / denom : 0,
  };
}

// Ein Fenster auswerten: roher + SEMI-PARTIAL residualisierter rankIC (§4a — nur die
// Return-Seite wird residualisiert, der Score-Rang bleibt roh; BH-151: keine volle
// Partial-Korrelation).
function windowIC(used) {
  if (used.length < 10) return { n: used.length, icRaw: null, icResid: null, nResid: 0, residControls: [] };
  const scores = used.map((u) => u.row.score);
  const rets = used.map((u) => u.ret);
  const icRaw = spearman(scores, rets);
  // §7-Basiskontrollen (immer gefordert). BH-158: log(marketCap) als vierte, praeregistrierte
  // Size-Kontrolle (Ledger:475) — write-board-history.js:buildPit friert marketCap bisher in
  // KEINEM Vintage ein (grep bestätigt), sie starr zu verlangen würde icResid flächendeckend
  // auf null ziehen. Wird stattdessen aufgenommen, SOBALD sie in der Kohorte auftaucht (rein
  // additiv, kein Warten auf den Freeze in write-board-history.js nötig).
  const coreFields = ['beta', 'evSales', 'priceGrossProfit'];
  const hasMarketCap = used.some((u) => u.row.pit && Number.isFinite(u.row.pit.marketCap) && u.row.pit.marketCap > 0);
  const fields = hasMarketCap ? coreFields.concat('marketCap') : coreFields;
  const ctlValue = (row, f) => (f === 'marketCap' ? Math.log(row.pit.marketCap) : row.pit[f]);
  const withCtl = used.filter((u) => u.row.pit && fields.every((f) => f === 'marketCap'
    ? (Number.isFinite(u.row.pit.marketCap) && u.row.pit.marketCap > 0)
    : Number.isFinite(u.row.pit[f])));
  let icResid = null;
  if (withCtl.length >= 10) {
    const y = withCtl.map((u) => u.ret);
    const ctl = fields.map((f) => withCtl.map((u) => ctlValue(u.row, f)));
    const resid = residualize(y, ctl);
    if (resid) icResid = spearman(withCtl.map((u) => u.row.score), resid);
  }
  return { n: used.length, icRaw, icResid, nResid: withCtl.length, residControls: fields };
}

// §4b Delivery-IC: Score(t0) vs realisiertes Umsatz-Wachstum bis zum Vintage >= t0+180d,
// PIT-Serien beider Vintages, Perioden-Ende-gematcht (forward-only).
function deliveryIC(vintage0, vintageLater) {
  const later = new Map();
  for (const t of ['profitable', 'unprofitable']) {
    for (const r of (vintageLater.cohort && vintageLater.cohort[t]) || []) later.set(r.ticker, r);
  }
  const xs = [], ys = [];
  let skippedNoBand = 0; // F10: Ticker ohne Later-Quartal im ~2Q-Band (fail-loud statt Horizont-Drift)
  // BH-150: `later` wird AUSSCHLIESSLICH aus vintageLater.cohort gebaut — ein t0-Ticker, der im
  // späteren Board-Vintage fehlt (delistet/eingebrochen/vom Board gefallen), hat dort keine
  // Zeile und wurde bisher lautlos verworfen (kein Attritions-Ausweis, Survivorship-Bias). Volle
  // Behebung (spätere Fundamentaldaten aus einem PIT-Store BEZIEHEN, nicht nur aus diesem einen
  // Board-Vintage) ist eine Datenquellen-/Architekturfrage außerhalb dieses Fixes (§4b ist laut
  // Ledger ohnehin non-konfirmatorisch/noch nicht scharf); hier wenigstens sichtbar machen.
  let attrition = 0;   // t0-Ticker mit gültiger t0-Basis, aber ohne jede Zeile im späteren Vintage
  let evaluable = 0;   // t0-Ticker mit gültiger t0-Basis (Score+Revenue) — Attritions-Nenner
  for (const t of ['profitable', 'unprofitable']) {
    for (const r of (vintage0.cohort && vintage0.cohort[t]) || []) {
      if (!Number.isFinite(r.score)) continue;
      const p0 = r.pit;
      if (!p0 || !Array.isArray(p0.revenueQ) || !Array.isArray(p0.revenueQEnds)) continue; // A10-Substrat nötig
      const end0 = p0.revenueQEnds[0], rev0 = p0.revenueQ[0];
      if (!end0 || !Number.isFinite(rev0) || rev0 <= 0) continue;
      const end0ms = Date.parse(end0);
      if (!Number.isFinite(end0ms)) continue;
      evaluable++;
      const w = later.get(r.ticker);
      const p1 = w && w.pit;
      if (!p1 || !Array.isArray(p1.revenueQ) || !Array.isArray(p1.revenueQEnds)) { attrition++; continue; }
      // F10/§4b/A12: das Later-Quartal an ~2Q nach end0 binden (Ziel end0+180d, akzeptiert im
      // Band [end0+150d, end0+210d]) und das dem Ziel NÄCHSTE nehmen — NICHT einfach das
      // neueste Perioden-Ende > end0. Ein voll gemeldeter Later-Snapshot enthält oft +3Q; ein
      // lückenhafter nur +1Q. Beides ausserhalb des Bandes -> Ticker überspringen, sonst mischt
      // der IC heterogene 1-3Q-Deltas. Kein Quartal im Band -> zählen (Ausweis in b.delivery).
      let rev1 = null, bestDev = Infinity;
      for (let i = 0; i < p1.revenueQ.length; i++) {
        const e1 = p1.revenueQEnds[i];
        if (!e1 || !Number.isFinite(p1.revenueQ[i])) continue;
        const gapDays = (Date.parse(e1) - end0ms) / 86400000;
        if (gapDays < DELIVERY_MIN_GAP_DAYS - DELIVERY_BAND_TOL_DAYS) continue;
        if (gapDays > DELIVERY_MIN_GAP_DAYS + DELIVERY_BAND_TOL_DAYS) continue;
        const dev = Math.abs(gapDays - DELIVERY_MIN_GAP_DAYS);
        if (dev < bestDev) { bestDev = dev; rev1 = p1.revenueQ[i]; }
      }
      if (rev1 === null) { skippedNoBand++; continue; }
      xs.push(r.score); ys.push(rev1 / rev0 - 1);
    }
  }
  const attritionRate = evaluable ? +(attrition / evaluable).toFixed(3) : 0;
  if (xs.length < 10) return { n: xs.length, ic: null, skippedNoBand, attrition, attritionRate };
  return { n: xs.length, ic: spearman(xs, ys), skippedNoBand, attrition, attritionRate };
}

// ── Hauptauswertung ──────────────────────────────────────────────────────────
function evaluate(historyDir, priceIndex, opts = {}) {
  const excluded = loadExcluded(historyDir);
  const allDates = listVintageDates(historyDir);
  const dates = allDates.filter((d) => !isDateExcluded(excluded, d));
  const report = {
    generatedAt: new Date().toISOString(),
    spec: 'Ledger 2.8 §1–§4/§8 + pre-registrierte Schwelle 2026-07-14 (84d>0,05 ∧ CI90-lo>0; BY-q=' + BY_Q + '; N_eff>=' + MIN_NEFF + ')',
    vintagesTotal: allDates.length,
    vintagesExcluded: allDates.filter((d) => isDateExcluded(excluded, d)),
    // board-enge Ausschlüsse getrennt ausweisen (das Datum bleibt für die anderen Boards drin).
    boardVintagesExcluded: allDates.flatMap((d) => {
      const e = excluded.get(d);
      return e && e.boards ? Array.from(e.boards, ([board, reason]) => ({ date: d, board, reason })) : [];
    }),
    boards: {},
    family: null,
  };
  if (!dates.length) { report.note = 'keine (nicht-exkludierten) Vintages — Reihe sammelt noch'; return report; }
  // §1-Haltedauer-Anker (Fund F5-2): ein Entscheidungspunkt zählt erst, wenn sein
  // Fenster real abgelaufen ist. Sonst würde der §8-Verkürzungspfad eine wenige Tage
  // alte Rendite als vollen 28d-/84d-Punkt buchen.
  const newestGlobal = opts.newestGlobal || newestPriceDate(priceIndex);
  report.newestPriceDate = newestGlobal;
  // BH-110: NUR das erste Vintage (dates[0]) nach Boards zu fragen macht ein Board, das im
  // ältesten Vintage noch fehlt (später hinzugekommen), für die GESAMTE Historie unsichtbar.
  // Union über ALLE (nicht-exkludierten) Vintages.
  const boards = Array.from(new Set(dates.flatMap((d) => boardsOf(historyDir, d)))).sort();
  const familyTests = []; // {board,horizon,p} für BY über die abschließende Familie
  for (const board of boards) {
    const b = { horizons: {}, delivery: null, exitRates: {}, unusableRates: {} };
    // Board-enge Ausschlüsse VOR dem §1-Fensterplan herausnehmen — genau wie beim globalen
    // Ausschluss, damit ein als korrupt erkanntes Vintage den Entscheidungspunkt nicht
    // belegt, sondern das nächste saubere Vintage nachrückt.
    const boardDates = dates.filter((d) => !isBoardExcluded(excluded, d, board));
    b.datesExcluded = dates.filter((d) => isBoardExcluded(excluded, d, board));
    for (const horizon of HORIZONS) {
      const decisions = disjointDecisionDates(boardDates, horizon);
      const points = [], pointsResid = [], detail = [];
      let pendingWindows = 0; // Fenster noch nicht abgelaufen — nie stillschweigend verschweigen
      for (const d of decisions) {
        if (newestGlobal && addDaysIso(d, horizon) > newestGlobal) { pendingWindows++; continue; }
        const v = loadVintage(historyDir, d, board);
        if (!v || !v.cohort) continue; // Sidecar/korrupte Datei zählt nie als Board-Vintage
        const rows = (v.cohort.profitable || []).concat(v.cohort.unprofitable || []);
        const w = windowReturns(priceIndex, rows, d, horizon);
        const ic = windowIC(w.used);
        b.exitRates[d + '/' + horizon] = +w.exitRate.toFixed(3);
        b.unusableRates[d + '/' + horizon] = +w.unusableRate.toFixed(3);
        detail.push({ date: d, n: ic.n, icRaw: ic.icRaw, icResid: ic.icResid, nResid: ic.nResid, quota: w.quota });
        if (Number.isFinite(ic.icRaw)) points.push(ic.icRaw);
        if (Number.isFinite(ic.icResid)) pointsResid.push(ic.icResid);
      }
      const mean = points.length ? points.reduce((s, v) => s + v, 0) / points.length : null;
      const meanResid = pointsResid.length ? pointsResid.reduce((s, v) => s + v, 0) / pointsResid.length : null;
      const ci = bootstrapCI(points, CI_LEVEL, opts.B || BOOTSTRAP_B, 20260714);
      const ciResid = bootstrapCI(pointsResid, CI_LEVEL, opts.B || BOOTSTRAP_B, 20260715);
      const ne = nEff(points);
      const neResid = nEff(pointsResid); // BH-107: eigene Power der Residual-Seite
      const powered = ne >= MIN_NEFF && mean !== null && ci;
      let verdict = 'unterpowert — kein Urteil (N_eff<' + MIN_NEFF + ')';
      let passRaw = false, residPowered = false, passResid = false;
      if (powered) {
        const thr = horizon === DECISION_HORIZON ? IC_THRESHOLD_84 : IC_GUIDE_28;
        passRaw = mean > thr && ci.lo > 0;
        // BH-107: Residualseite braucht ihre EIGENE Power (neResid), nicht die der Raw-Seite —
        // vorher konnte ein unterpowertes Residual-CI trotzdem in die Konjunktion einfließen.
        residPowered = meanResid !== null && ciResid && neResid >= MIN_NEFF;
        passResid = residPowered ? (meanResid > thr && ciResid.lo > 0) : false;
        // §4a UND-Regel nur am Entscheidungs-Horizont; 28d bleibt Richtwert.
        const pass = horizon === DECISION_HORIZON ? (passRaw && passResid) : passRaw;
        verdict = pass ? 'LIVE-Kriterium erfüllt (vorbehaltlich BY-FDR)' : 'DIAGNOSTIC-Kandidat (Prüf-Flag, kein Sofort-Cut)';
      }
      // BH-158: MDE (Minimum Detectable Effect) je Board/Horizont als Pflicht-Ausweis, aus der
      // N_eff-adjustierten Streuung der Fenster-IC-Punkte (reiner Ausweis, kein Verdict-Kriterium).
      const sd = stddev(points);
      const mde = (sd !== null && ne > 0) ? +(MDE_Z * sd / Math.sqrt(ne)).toFixed(4) : null;
      b.horizons[horizon] = {
        decisions: detail, nPoints: points.length, pendingWindows, nEff: +(+ne).toFixed(2), mde,
        meanICRaw: mean === null ? null : +mean.toFixed(4),
        meanICResid: meanResid === null ? null : +meanResid.toFixed(4),
        // BH-151: icResid ist SEMI-PARTIAL (nur die Return-Seite wird residualisiert, der
        // Score-Rang bleibt roh) — nicht mit einer vollen Partial-Korrelation verwechseln.
        icResidLabel: 'semi-partial (nur Return residualisiert)',
        ci90: ci ? { lo: +ci.lo.toFixed(4), hi: +ci.hi.toFixed(4) } : null,
        ci90Resid: ciResid ? { lo: +ciResid.lo.toFixed(4), hi: +ciResid.hi.toFixed(4) } : null,
        verdict,
      };
      // BH-107: BY-FDR muss über die VOLLE Familie (jedes Board × Horizont) laufen, nicht nur
      // über die gerade messbaren/gepowerten Punkte — sonst schrumpft m und die BY-Schwelle wird
      // bei wenig Daten künstlich liberaler. Nicht (aus)messbare/unterpowerte Tests zählen als
      // p=1 (nie signifikant), tragen aber zur Familiengröße bei. Am Entscheidungs-Horizont ist
      // der Familientest die Raw∧Residual-Konjunktion (Intersection-Union-Test: p_conj =
      // max(p_raw,p_resid), Berger 1982) — beide Seiten brauchen eigene Power, sonst bleibt die
      // Konjunktion unbewiesen (p=1).
      let famP = 1;
      if (horizon === DECISION_HORIZON) {
        if (powered && ci && residPowered) famP = Math.max(ci.p, ciResid.p);
      } else if (powered && ci) {
        famP = ci.p;
      }
      familyTests.push({ board, horizon, p: famP });
    }
    // §4b: jüngstes Paar (erstes Vintage, erstes Vintage >= +180d) — auf den für dieses
    // Board zulässigen Vintages (ein exkludiertes Vintage darf auch den Delivery-IC nicht tragen).
    const d0 = boardDates[0];
    const dLater = d0 && boardDates.find((d) => (new Date(d) - new Date(d0)) / 86400000 >= DELIVERY_MIN_GAP_DAYS);
    if (dLater) {
      const v0 = loadVintage(historyDir, d0, board), v1 = loadVintage(historyDir, dLater, board);
      if (v0 && v1) b.delivery = Object.assign({ t0: d0, t1: dLater }, deliveryIC(v0, v1));
    } else {
      b.delivery = { note: 'noch nicht scharf — braucht Vintage >= t0+' + DELIVERY_MIN_GAP_DAYS + 'd (§4b/A12)' };
    }
    report.boards[board] = b;
  }
  // §3b/§3c: BY-FDR über die abschließende Familie — JEDES Board×Horizont (BH-107; p=1
  // für nicht (aus)messbare/unterpowerte Paare, siehe Kommentar oben in der Schleife).
  if (familyTests.length) {
    const sig = benjaminiYekutieli(familyTests.map((t) => t.p), BY_Q);
    report.family = familyTests.map((t, i) => ({ board: t.board, horizon: t.horizon, p: +t.p.toFixed(4), bySignificant: sig[i] }));
  } else {
    report.family = 'keine Tests mit N_eff>=' + MIN_NEFF + ' — Familie leer (erwartete Wartezeit, §3d/§7)';
  }
  return report;
}

// loadPriceIndexOrThrow — Verdrahtung Store->Index, fail-loud statt still leer.
// R-Gate 2.R Fund F5-1: der Aufruf stand auf prices/history, während der Store
// selbst 'history' anhängt (Vertrag: loadAll(pricesDir), siehe price-history-store.js
// Kopf + alle anderen Aufrufer) -> Index leer -> JEDER Board-Punkt n=0 und die
// gesamte Messreihe meldete "unterpowert", obwohl sie schlicht nichts gemessen hat.
// Ein leerer Index ist ab jetzt ein harter Fehler: die Messreihe darf nie wieder
// aus einem Pfad-Artefakt ein methodisches Urteil ableiten.
function loadPriceIndexOrThrow(pricesDir) {
  const history = store.loadAll(pricesDir);
  const tickers = Object.keys(history).length;
  if (tickers === 0) {
    throw new Error(
      '[rank-ic] Preis-Index LEER aus ' + pricesDir + ' — ohne Kurse ist jeder IC-Punkt n=0 '
      + 'und jedes "unterpowert"-Urteil ein Artefakt. Erwartet wird das prices-Verzeichnis '
      + '(der Store hängt "history" selbst an).',
    );
  }
  return buildPriceIndex(history);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const getArg = (k, dflt) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : dflt; };
  const historyDir = path.resolve(REPO_ROOT, getArg('--history-dir', 'board-history'));
  const outFile = path.resolve(REPO_ROOT, getArg('--out', path.join('outputs', 'rank-ic-report.json')));
  const priceIndex = loadPriceIndexOrThrow(path.join(REPO_ROOT, 'prices'));
  const report = evaluate(historyDir, priceIndex);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('[rank-ic] Vintages: ' + report.vintagesTotal + ' (exkludiert: ' + (report.vintagesExcluded || []).join(',') + ')');
  for (const [board, b] of Object.entries(report.boards || {})) {
    const h = b.horizons && b.horizons[DECISION_HORIZON];
    if (h) console.log(`  ${board}: 84d nPoints=${h.nPoints} (pending=${h.pendingWindows}) N_eff=${h.nEff} meanIC=${h.meanICRaw} CI90=[${h.ci90 ? h.ci90.lo + ',' + h.ci90.hi : '—'}] -> ${h.verdict}`);
  }
  console.log('[rank-ic] Report -> ' + outFile);
}

module.exports = { spearman, ranks, residualize, bootstrapCI, nEff, benjaminiYekutieli, disjointDecisionDates, windowReturns, windowIC, deliveryIC, evaluate, loadExcluded, isDateExcluded, isBoardExcluded, loadPriceIndexOrThrow, newestPriceDate, invNormalCdf, stddev, loadVintage };
if (require.main === module) main();
