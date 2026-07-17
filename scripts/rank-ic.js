'use strict';
/**
 * scripts/rank-ic.js — Auswertung der 2.3-Vintage-Messreihe nach der
 * pre-registrierten 2.8-MESS-FUNDAMENT-Spezifikation (Formel-Ledger §1–§4, §8)
 * und der pre-registrierten Erfolgsschwelle (Ledger-Kapitel „2.3 PRE-REGISTRIERTE
 * rankIC-ERFOLGSSCHWELLE", eingefroren 2026-07-14, VOR Vintage #1).
 *
 *  §1  Entscheidungs-IC NUR auf disjunkten 84-KALENDERTAGE-Quartalsfenstern
 *      (erstes Vintage = t0; nächster Entscheidungspunkt = erstes Vintage >= t0+84d …).
 *      Die tägliche (überlappende) Reihe läuft als DIAGNOSE mit Newey-West-SE.
 *  §2  Block-Bootstrap-CI (B=2000, Resampling der disjunkten Punkte) für den
 *      mittleren IC; N_eff aus der Lag-1-Autokorrelation der Punkt-Reihe (§3a).
 *  §3  Entscheidung: CI-Untergrenze(90 %) > 0 UND mittlerer 84d-IC > 0,05
 *      (UND-Regel roh+residualisiert, §4a); Benjamini-YEKUTIELI-FDR über die
 *      abschließende Familie 14 Boards × {28d, 84d} = 28 Tests; §3d Mindest-Power:
 *      N_eff < 8 => „unterpowert — KEIN Urteil" (weder LIVE-Bestätigung noch Cut).
 *  §4a Doppel-Report: roher Spearman-rankIC UND residualisierter IC (Forward-
 *      Returns cross-sectional gegen die PIT-Kontrollen beta/evSales/priceGrossProfit
 *      regressiert — Rang-basierte OLS auf present-Kontrollen; fehlende Kontrolle
 *      => Zeile bleibt im ROHEN IC, fällt aus dem residualisierten (Ausweis).
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
 *  Exclude: board-history/_excluded.json ({"YYYY-MM-DD": "grund"} ODER Liste) —
 *      exkludierte Vintages fallen nachweislich aus JEDER Rechnung (Ausweis im Report).
 *
 * Usage: node scripts/rank-ic.js [--history-dir board-history] [--out outputs/rank-ic-report.json]
 * Exit 0 = Report geschrieben (auch „keine auswertbaren Fenster" ist ein gültiger Report).
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
const BOOTSTRAP_B = 2000;             // §2
const MIN_NEFF = 8;                   // §3d Mindest-Power
const BY_Q = 0.10;                    // §3b Benjamini-Yekutieli-FDR-Niveau
const DELIVERY_MIN_GAP_DAYS = 180;    // §4b: t0+2Q (A12-Kopplung)

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

// §2: Bootstrap-CI des Mittelwerts über die disjunkten Punkte (Resampling mit
// Zurücklegen; deterministisch via LCG-Seed, damit Läufe reproduzierbar sind).
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function bootstrapCI(points, level, B, seed) {
  const n = points.length;
  if (n === 0) return null;
  const rnd = lcg(seed);
  const means = new Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += points[Math.floor(rnd() * n)];
    means[b] = s / n;
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  const lo = means[Math.max(0, Math.floor(alpha * B))];
  const hi = means[Math.min(B - 1, Math.ceil((1 - alpha) * B) - 1)];
  // p-Wert (einseitig, H0: mean<=0): Anteil Bootstrap-Mittel <= 0, min 1/B (nie exakt 0).
  const pLeq0 = Math.max(1 / B, means.filter((m) => m <= 0).length / B);
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
function loadExcluded(historyDir) {
  const f = path.join(historyDir, '_excluded.json');
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(raw)) return new Map(raw.map((d) => [d, 'excluded']));
    return new Map(Object.entries(raw).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k)));
  } catch (_) { return new Map(); }
}
function listVintageDates(historyDir) {
  let entries = [];
  try { entries = fs.readdirSync(historyDir); } catch (_) { return []; }
  return entries.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}
function loadVintage(historyDir, date, board) {
  return (function () {
    try { return JSON.parse(fs.readFileSync(path.join(historyDir, date, board + '.json'), 'utf8')); }
    catch (_) { return null; }
  })();
}
function boardsOf(historyDir, date) {
  // Board = Datei mit cohort-Objekt. Der Vintage-Ordner trägt auch Sidecars
  // (calibration.json, regime.json — write-board-history legt sie daneben);
  // namensbasiertes Filtern bricht beim nächsten Sidecar wieder, also inhaltsbasiert.
  try {
    return fs.readdirSync(path.join(historyDir, date))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((b) => { const v = loadVintage(historyDir, date, b); return !!(v && v.cohort); });
  } catch (_) { return []; }
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

// ── Forward-Returns je Vintage-Kohorte (§8) ──────────────────────────────────
function windowReturns(priceIndex, rows, t0, horizonDays) {
  const t1 = (() => { const d = new Date(t0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + horizonDays); return d.toISOString().slice(0, 10); })();
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
  return { used, quota, exitRate: denom ? (quota.delisted + quota.shortened + quota.excluded_no_series) / denom : 0 };
}

// Ein Fenster auswerten: roher + residualisierter rankIC (§4a).
function windowIC(used) {
  if (used.length < 10) return { n: used.length, icRaw: null, icResid: null, nResid: 0 };
  const scores = used.map((u) => u.row.score);
  const rets = used.map((u) => u.ret);
  const icRaw = spearman(scores, rets);
  // Residualisierung nur über Zeilen mit ALLEN drei Kontrollen present (Ausweis via nResid).
  const withCtl = used.filter((u) => u.row.pit && ['beta', 'evSales', 'priceGrossProfit'].every((f) => Number.isFinite(u.row.pit[f])));
  let icResid = null;
  if (withCtl.length >= 10) {
    const y = withCtl.map((u) => u.ret);
    const ctl = ['beta', 'evSales', 'priceGrossProfit'].map((f) => withCtl.map((u) => u.row.pit[f]));
    const resid = residualize(y, ctl);
    if (resid) icResid = spearman(withCtl.map((u) => u.row.score), resid);
  }
  return { n: used.length, icRaw, icResid, nResid: withCtl.length };
}

// §4b Delivery-IC: Score(t0) vs realisiertes Umsatz-Wachstum bis zum Vintage >= t0+180d,
// PIT-Serien beider Vintages, Perioden-Ende-gematcht (forward-only).
function deliveryIC(vintage0, vintageLater) {
  const later = new Map();
  for (const t of ['profitable', 'unprofitable']) {
    for (const r of (vintageLater.cohort && vintageLater.cohort[t]) || []) later.set(r.ticker, r);
  }
  const xs = [], ys = [];
  for (const t of ['profitable', 'unprofitable']) {
    for (const r of (vintage0.cohort && vintage0.cohort[t]) || []) {
      if (!Number.isFinite(r.score)) continue;
      const p0 = r.pit, w = later.get(r.ticker);
      const p1 = w && w.pit;
      if (!p0 || !p1 || !Array.isArray(p0.revenueQ) || !Array.isArray(p1.revenueQ)) continue;
      if (!Array.isArray(p0.revenueQEnds) || !Array.isArray(p1.revenueQEnds)) continue; // A10-Substrat nötig
      const end0 = p0.revenueQEnds[0], rev0 = p0.revenueQ[0];
      if (!end0 || !Number.isFinite(rev0) || rev0 <= 0) continue;
      // jüngstes Later-Quartal, dessen Perioden-Ende NACH end0 liegt und >= ~2 Quartale weiter
      let rev1 = null;
      for (let i = 0; i < p1.revenueQ.length; i++) {
        const e1 = p1.revenueQEnds[i];
        if (e1 && e1 > end0 && Number.isFinite(p1.revenueQ[i])) { rev1 = p1.revenueQ[i]; break; }
      }
      if (rev1 === null) continue;
      xs.push(r.score); ys.push(rev1 / rev0 - 1);
    }
  }
  if (xs.length < 10) return { n: xs.length, ic: null };
  return { n: xs.length, ic: spearman(xs, ys) };
}

// ── Hauptauswertung ──────────────────────────────────────────────────────────
function evaluate(historyDir, priceIndex, opts = {}) {
  const excluded = loadExcluded(historyDir);
  const allDates = listVintageDates(historyDir);
  const dates = allDates.filter((d) => !excluded.has(d));
  const report = {
    generatedAt: new Date().toISOString(),
    spec: 'Ledger 2.8 §1–§4/§8 + pre-registrierte Schwelle 2026-07-14 (84d>0,05 ∧ CI90-lo>0; BY-q=' + BY_Q + '; N_eff>=' + MIN_NEFF + ')',
    vintagesTotal: allDates.length,
    vintagesExcluded: Array.from(excluded.keys()).filter((d) => allDates.includes(d)),
    boards: {},
    family: null,
  };
  if (!dates.length) { report.note = 'keine (nicht-exkludierten) Vintages — Reihe sammelt noch'; return report; }
  const boards = boardsOf(historyDir, dates[0]);
  const familyTests = []; // {board,horizon,p} für BY über die abschließende Familie
  for (const board of boards) {
    const b = { horizons: {}, delivery: null, exitRates: {} };
    for (const horizon of HORIZONS) {
      const decisions = disjointDecisionDates(dates, horizon);
      const points = [], pointsResid = [], detail = [];
      for (const d of decisions) {
        const v = loadVintage(historyDir, d, board);
        if (!v || !v.cohort) continue; // Sidecar/korrupte Datei zählt nie als Board-Vintage
        const rows = (v.cohort.profitable || []).concat(v.cohort.unprofitable || []);
        const w = windowReturns(priceIndex, rows, d, horizon);
        const ic = windowIC(w.used);
        b.exitRates[d + '/' + horizon] = +w.exitRate.toFixed(3);
        detail.push({ date: d, n: ic.n, icRaw: ic.icRaw, icResid: ic.icResid, nResid: ic.nResid, quota: w.quota });
        if (Number.isFinite(ic.icRaw)) points.push(ic.icRaw);
        if (Number.isFinite(ic.icResid)) pointsResid.push(ic.icResid);
      }
      const mean = points.length ? points.reduce((s, v) => s + v, 0) / points.length : null;
      const meanResid = pointsResid.length ? pointsResid.reduce((s, v) => s + v, 0) / pointsResid.length : null;
      const ci = bootstrapCI(points, CI_LEVEL, opts.B || BOOTSTRAP_B, 20260714);
      const ciResid = bootstrapCI(pointsResid, CI_LEVEL, opts.B || BOOTSTRAP_B, 20260715);
      const ne = nEff(points);
      let verdict = 'unterpowert — kein Urteil (N_eff<' + MIN_NEFF + ')';
      if (ne >= MIN_NEFF && mean !== null && ci) {
        const thr = horizon === DECISION_HORIZON ? IC_THRESHOLD_84 : IC_GUIDE_28;
        const passRaw = mean > thr && ci.lo > 0;
        const passResid = meanResid !== null && ciResid ? (meanResid > thr && ciResid.lo > 0) : false;
        // §4a UND-Regel nur am Entscheidungs-Horizont; 28d bleibt Richtwert.
        const pass = horizon === DECISION_HORIZON ? (passRaw && passResid) : passRaw;
        verdict = pass ? 'LIVE-Kriterium erfüllt (vorbehaltlich BY-FDR)' : 'DIAGNOSTIC-Kandidat (Prüf-Flag, kein Sofort-Cut)';
      }
      b.horizons[horizon] = {
        decisions: detail, nPoints: points.length, nEff: +(+ne).toFixed(2),
        meanICRaw: mean === null ? null : +mean.toFixed(4),
        meanICResid: meanResid === null ? null : +meanResid.toFixed(4),
        ci90: ci ? { lo: +ci.lo.toFixed(4), hi: +ci.hi.toFixed(4) } : null,
        ci90Resid: ciResid ? { lo: +ciResid.lo.toFixed(4), hi: +ciResid.hi.toFixed(4) } : null,
        verdict,
      };
      if (ci && ne >= MIN_NEFF) familyTests.push({ board, horizon, p: ci.p });
    }
    // §4b: jüngstes Paar (erstes Vintage, erstes Vintage >= +180d)
    const d0 = dates[0];
    const dLater = dates.find((d) => (new Date(d) - new Date(d0)) / 86400000 >= DELIVERY_MIN_GAP_DAYS);
    if (dLater) {
      const v0 = loadVintage(historyDir, d0, board), v1 = loadVintage(historyDir, dLater, board);
      if (v0 && v1) b.delivery = Object.assign({ t0: d0, t1: dLater }, deliveryIC(v0, v1));
    } else {
      b.delivery = { note: 'noch nicht scharf — braucht Vintage >= t0+' + DELIVERY_MIN_GAP_DAYS + 'd (§4b/A12)' };
    }
    report.boards[board] = b;
  }
  // §3b/§3c: BY-FDR über die abschließende Familie (nur Tests mit ausreichender Power).
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
    if (h) console.log(`  ${board}: 84d nPoints=${h.nPoints} N_eff=${h.nEff} meanIC=${h.meanICRaw} CI90=[${h.ci90 ? h.ci90.lo + ',' + h.ci90.hi : '—'}] -> ${h.verdict}`);
  }
  console.log('[rank-ic] Report -> ' + outFile);
}

module.exports = { spearman, ranks, residualize, bootstrapCI, nEff, benjaminiYekutieli, disjointDecisionDates, windowReturns, windowIC, deliveryIC, evaluate, loadExcluded, loadPriceIndexOrThrow };
if (require.main === module) main();
