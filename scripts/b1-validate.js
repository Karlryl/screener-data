'use strict';
/**
 * scripts/b1-validate.js — B1 KONFIRMATORISCHER Lauf (Protokoll Tag 389,
 * SHA-256 7b20e750261ca5a6ede207064275d3934f11408565865477baced74ee0cf0f79).
 *
 * Validation-Ära 2019-01-01..2024-12-31, EIN Lauf (§6). Lockbox 2025+ wird hier
 * strukturell NIE angefasst (Ära-Konstanten unten, Preise nach Timeout-Ende 2025
 * werden nur als Forward-Fenster der 2024er-Events berührt — das ist Outcome der
 * Validation-Events, nicht Lockbox-Event-Erkennung).
 *
 * Pipeline (§§1–8): Events via lib/b1-detect (byte-gleich zur Instrumentierung)
 * → Discovery-Event-Firmen aus dem Event-Pool ausschließen → Tag 0 = filed;
 * Einstieg = Schlusskurs des Handelstags NACH Tag 0 → kontemporäres Matching
 * (SIC2 exakt via SEC-submissions-Cache; Mahalanobis ≤ 1,0 auf standardisierten
 * logMcap/6M-Momentum/EV-Sales-Perzentil; Kontrolle max 1×/Kalenderquartal)
 * → First-Passage ±k·σ_daily·√250 auf Tages-Closes, Timeout 250 Hd = Miss
 * → Paar-Differenz, Cluster-Bootstrap (SIC2×CalQ), BCa + N_eff-Verbreiterung
 * → BY über die m=6-Familie → Verdikt nach §8 (Balance-Gate 5 pp, Power-Gate
 * N_eff≥8, Shumway-Veto).
 *
 * Testbarkeit: alle Kernfunktionen pur + injizierbare Quellen (priceLookup,
 * sicLookup) — tests/b1-validate.test.js beweist die Engine synthetisch, BEVOR
 * der eine echte Lauf startet.
 *
 * Usage: SEC_CONTACT=mail node scripts/b1-validate.js [--dry-run]
 *   --dry-run: Events+Matching+Gates rechnen und ausweisen, KEINE Outcome-/
 *              Inferenz-Rechnung (Vorprüfung der Machbarkeit, §6-verträglich,
 *              da keine Renditen berührt werden).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const secPit = require('../lib/sec-pit.js');
const detect = require('../lib/b1-detect.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const rankIc = require('./rank-ic.js'); // invNormalCdf/stddev/nEff — Wiederverwendung

const REPO_ROOT = path.resolve(__dirname, '..');
const MAX_DIR = path.join(REPO_ROOT, 'prices-max');
const SUBMISSIONS_DIR = path.join(secPit.CACHE_DIR, 'submissions');
const OUT_BASE = path.join(REPO_ROOT, 'reports', 'b1-validation-2026-07-19');

// ── präregistrierte Konstanten (Protokoll §§1–8; KEINE freien Parameter) ─────
const VAL_START = '2019-01-01', VAL_END = '2024-12-31';
const DISC_END = '2018-12-31';
const K_SIGMA = 2.0, K_SIGMA_ROBUST = 1.5;      // §4 / View 3
const VOL_LOOKBACK = 60, TIMEOUT_TD = 250;       // §4
const CALIPER = 1.0;                             // §5 (Mahalanobis)
const BALANCE_GATE_PP = 0.05;                    // §8
const MIN_NEFF_CLUSTERS = 8;                     // §8
const BY_Q = 0.10;                               // §7
const MOM_TD = 126;                              // 6M-Momentum (§5)
const B_BOOT = 10000, BOOT_SEED = 20260719;

// ── Preis-Zugriff (prices-max, Tages-Closes aufsteigend) ─────────────────────
function loadPriceSeries(ticker) {
  try {
    const bars = JSON.parse(fs.readFileSync(path.join(MAX_DIR, safeSnapshotFilename(ticker)), 'utf8'));
    return Array.isArray(bars) && bars.length ? bars : null;
  } catch (_) { return null; }
}

// Erster Handelstag-Index mit date >= d (binäre Suche unnötig bei ~10k Bars).
function idxOnOrAfter(bars, d) {
  for (let i = 0; i < bars.length; i++) if (bars[i].date >= d) return i;
  return -1;
}

// §3/§4: Tag 0 = erster Handelstag >= filed; Einstieg = Close von Tag 0 + entryLag.
// σ_daily aus VOL_LOOKBACK Log-Returns VOR Tag 0. Rückgabe null + Grund, wenn
// Substrat fehlt (Balance-Gate-Zählung beim Aufrufer).
// Dry Round #2 Fund T2-2 + Duell-Ruling 20.07. (Option E, fail closed): die
// fruehere imputeMissing-Abkuerzung (JEDES Serienende = Miss) verletzte das
// eingefrorene Protokoll par.7 Nr. 6 (nur PERFORMANCE-bedingte Serienenden,
// Klassifikation via forward-returns.classify). Eine protokolltreue
// Klassifikation existiert unter Court E-20260720-5 nicht mehr (close<=0 ist
// nie Delisting-Beleg; 'delisted' fuer wohlgeformte Adapter unerreichbar,
// Codex-Duell Einwand 3-5) -> die Shumway-View ist OHNE unabhaengige
// Delisting-Labels NICHT SCHAETZBAR und wird fail-closed gefuehrt
// (protocol/b1-addendum-20260720-shumway.md). firstPassage liefert deshalb
// immer die ehrlichen Serienende-Status, imputiert nie.
function firstPassage(bars, filedDate, { kSigma = K_SIGMA, entryLag = 1 } = {}) {
  if (!bars) return { status: 'no_series' };
  const d0 = idxOnOrAfter(bars, filedDate);
  if (d0 < 0) return { status: 'no_day0' };
  if (d0 < VOL_LOOKBACK + 1) return { status: 'insufficient_history' };
  let sum2 = 0, n = 0;
  for (let i = d0 - VOL_LOOKBACK; i < d0; i++) {
    const r = Math.log(bars[i + 1 - 1].close / bars[i - 1].close); // Returns bis einschließlich d0-1
    if (Number.isFinite(r)) { sum2 += r * r; n++; }
  }
  if (n < VOL_LOOKBACK * 0.8) return { status: 'insufficient_history' };
  const sigmaDaily = Math.sqrt(sum2 / n);
  if (!(sigmaDaily > 0)) return { status: 'zero_vol' };
  const entryIdx = d0 + entryLag;
  if (entryIdx >= bars.length) return { status: 'series_ended_pre_entry' };
  const entry = bars[entryIdx].close;
  const up = entry * Math.exp(kSigma * sigmaDaily * Math.sqrt(TIMEOUT_TD));
  const dn = entry * Math.exp(-kSigma * sigmaDaily * Math.sqrt(TIMEOUT_TD));
  const last = Math.min(bars.length - 1, entryIdx + TIMEOUT_TD);
  for (let i = entryIdx + 1; i <= last; i++) {
    if (bars[i].close >= up) return { status: 'ok', upperFirst: true, days: i - entryIdx };
    if (bars[i].close <= dn) return { status: 'ok', upperFirst: false, days: i - entryIdx, lower: true };
  }
  if (entryIdx + TIMEOUT_TD > bars.length - 1) {
    // Serie endet vor Timeout ohne Barriere: unbrauchbar (Ausweis) — in ALLEN
    // Views; die fruehere Shumway-Imputation an dieser Stelle war der
    // Dry-Round-#2-T2-Fund (Protokoll-Bruch, s. Funktionskommentar).
    return { status: 'series_ended_in_window' };
  }
  return { status: 'ok', upperFirst: false, timeout: true };
}

// 6M-Momentum + Marktkapital-Proxy am Tag 0 (adjclose×letzte dei-Shares; Verzerrung
// durch spätere Splits als Limitation dokumentiert — wirkt auf beide Gruppen gleich
// innerhalb desselben Stichtags).
function matchVarsAt(bars, filedDate, sharesSeries) {
  const d0 = idxOnOrAfter(bars, filedDate);
  if (d0 < MOM_TD + 1) return null;
  const px = bars[d0].close;
  const mom = px / bars[d0 - MOM_TD].close - 1;
  let shares = null;
  if (Array.isArray(sharesSeries)) {
    for (const s of sharesSeries) { if (s.end <= filedDate) { shares = s.val; break; } } // Serie end-absteigend
  }
  const mcap = shares && shares > 0 ? px * shares : null;
  return { mom, mcap };
}

// ── SEC submissions (SIC + Ticker) mit lokalem Cache ─────────────────────────
function submissionsPath(cik) { return path.join(SUBMISSIONS_DIR, 'CIK' + String(cik).padStart(10, '0') + '.json'); }
function readSubmissionsCached(cik) {
  try { return JSON.parse(fs.readFileSync(submissionsPath(cik), 'utf8')); } catch (_) { return null; }
}
function fetchSubmissions(cik, contact) {
  return new Promise((resolve) => {
    const url = 'https://data.sec.gov/submissions/CIK' + String(cik).padStart(10, '0') + '.json';
    const req = https.get(url, { headers: { 'User-Agent': 'screener-data research ' + contact, 'Accept-Encoding': 'identity' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const lean = { cik, sic: j.sic || null, sicDescription: j.sicDescription || null, tickers: j.tickers || [] };
          fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
          // T204 Welle 5: atomar, weil ein zerrissener Cache-Eintrag hier STILL wirkt und
          // DAUERHAFT bleibt. readSubmissionsCached faengt den Parse-Fehler ab und liefert
          // null (catch (_) { return null; }), sic2Of macht daraus null, enrich() steigt
          // aus — die Firma faellt lautlos aus dem SIC2-Matching-Pool des EINEN
          // konfirmatorischen B1-Laufs. Und ensureSubmissions holt sie nie nach: der
          // Nachlade-Filter fragt nur `!fs.existsSync(...)`, und ein Bruchstueck existiert.
          writeFileAtomic(submissionsPath(cik), JSON.stringify(lean));
          resolve(lean);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
  });
}
async function ensureSubmissions(ciks, contact) {
  const missing = ciks.filter((c) => !fs.existsSync(submissionsPath(c)));
  if (missing.length && (!contact || !/@/.test(contact))) {
    throw new Error('SEC_CONTACT fehlt: ' + missing.length + ' submissions-Abrufe (SIC/Sektor) nötig. Kein Request gesendet.');
  }
  let done = 0;
  for (const c of missing) {
    await fetchSubmissions(c, contact);
    done++;
    if (done % 200 === 0) console.log('[b1-validate] submissions ' + done + '/' + missing.length);
    await new Promise((r) => setTimeout(r, 120)); // SEC-schonend (<10 req/s)
  }
  return { fetched: missing.length };
}
function sic2Of(cik) {
  const s = readSubmissionsCached(cik);
  const sic = s && s.sic ? String(s.sic) : null;
  return sic && sic.length >= 2 ? sic.slice(0, 2) : null;
}

// ── EV/Sales-Perzentil (PIT, §5) ─────────────────────────────────────────────
const DEBT_LT = ['LongTermDebtNoncurrent', 'LongTermDebt'];
const DEBT_ST = ['DebtCurrent', 'ShortTermBorrowings', 'LongTermDebtCurrent'];
const CASH = ['CashAndCashEquivalentsAtCarryingValue'];
function latestInstant(facts, concepts, asOf) {
  const tax = facts && facts.facts && facts.facts['us-gaap'];
  if (!tax) return null;
  for (const c of concepts) {
    const node = tax[c];
    const arr = node && node.units && node.units.USD;
    const s = secPit.pitSeriesFromFacts(arr, { asOf, period: 'instant' });
    if (s.length) return s[0].val;
  }
  return null;
}
function evSales(facts, mcap, asOf) {
  if (!Number.isFinite(mcap)) return null;
  const rev = secPit.pitQuarterlyWithDerivedQ4(facts, secPit.REV_CONCEPTS, { asOf });
  if (rev.series.length < 4) return null;
  const ltm = rev.series.slice(0, 4).reduce((s, p) => s + p.val, 0);
  if (!(ltm > 0)) return null;
  const debt = (latestInstant(facts, DEBT_LT, asOf) || 0) + (latestInstant(facts, DEBT_ST, asOf) || 0);
  const cash = latestInstant(facts, CASH, asOf) || 0;
  return (mcap + Math.max(0, debt - cash)) / ltm;
}

function recordVarsAt(asOf, facts, bars) {
  if (!bars) return { hasBars: false, vars: null };
  const shares = facts ? secPit.sharesHistory(facts, { asOf }) : [];
  const mv = matchVarsAt(bars, asOf, shares);
  if (!mv) return { hasBars: true, vars: null };
  const evs = facts ? evSales(facts, mv.mcap, asOf) : null;
  return {
    hasBars: true,
    vars: { logMcap: mv.mcap ? Math.log(mv.mcap) : NaN, mom: mv.mom, evsRaw: evs },
  };
}

// Kandidaten werden pro Eventdatum neu geschnitten und bewertet. Facts/Bars
// werden je Firmen-Periode einmal geladen und fuer alle benoetigten Daten genutzt.
function buildEventDatedCandidatePools(events, candidates, deps, cache) {
  const datedCache = cache || new Map();
  const candidatesByQ = new Map();
  for (const c of candidates) {
    let arr = candidatesByQ.get(c.calQ);
    if (!arr) candidatesByQ.set(c.calQ, arr = []);
    arr.push(c);
  }
  const groups = new Map();
  for (const ev of events) {
    const key = ev.calQ + '|' + ev.filed;
    let arr = groups.get(key);
    if (!arr) groups.set(key, arr = []);
    arr.push(ev);
  }
  // Anforderungen in der bisherigen Gruppen-Reihenfolge sammeln, die teuren
  // Loads danach aber Record-aussen/Termine-innen ausfuehren.
  const requiredByRecord = new Map(), missingKeys = [], requested = new Set();
  const requireAt = (r, asOf) => {
    const key = r.cik + '|' + r.end + '|' + asOf;
    if (datedCache.has(key) || requested.has(key)) return;
    requested.add(key); missingKeys.push(key);
    const recordKey = r.cik + '|' + r.end;
    let job = requiredByRecord.get(recordKey);
    if (!job) requiredByRecord.set(recordKey, job = { record: r, dates: [] });
    job.dates.push(asOf);
  };
  for (const groupedEvents of groups.values()) {
    const asOf = groupedEvents[0].filed, calQ = groupedEvents[0].calQ;
    for (const ev of groupedEvents) requireAt(ev, asOf);
    for (const c of candidatesByQ.get(calQ) || []) requireAt(c, asOf);
  }
  const computed = new Map();
  let nextMissing = 0;
  for (const { record, dates } of requiredByRecord.values()) {
    const bars = record.ticker ? deps.barsOf(record.ticker) : null;
    const facts = bars ? deps.factsOf(record.cik) : null;
    for (const asOf of dates) {
      const key = record.cik + '|' + record.end + '|' + asOf;
      computed.set(key, recordVarsAt(asOf, facts, bars));
    }
    while (nextMissing < missingKeys.length && computed.has(missingKeys[nextMissing])) {
      const key = missingKeys[nextMissing++];
      datedCache.set(key, computed.get(key));
      computed.delete(key);
    }
  }
  const getAt = (r, asOf) => datedCache.get(r.cik + '|' + r.end + '|' + asOf);
  const pools = new Map();
  for (const groupedEvents of groups.values()) {
    const asOf = groupedEvents[0].filed, calQ = groupedEvents[0].calQ;
    for (const ev of groupedEvents) {
      const at = getAt(ev, asOf);
      ev.hasBars = at.hasBars;
      ev.vars = at.vars ? { ...at.vars } : null;
    }
    const datedCandidates = (candidatesByQ.get(calQ) || []).map((c) => {
      const at = getAt(c, asOf);
      return { ...c, hasBars: at.hasBars, vars: at.vars ? { ...at.vars } : null };
    });
    const universe = [...groupedEvents, ...datedCandidates]
      .filter((r) => r.vars && Number.isFinite(r.vars.evsRaw));
    const sorted = universe.map((r) => r.vars.evsRaw).sort((a, b) => a - b);
    for (const r of universe) r.vars.evsPctl = sorted.findIndex((v) => v >= r.vars.evsRaw) / sorted.length;
    for (const ev of groupedEvents) pools.set(ev, datedCandidates);
  }
  return pools;
}

function selectViewRecords(records, view, excludedEventCiks) {
  const cloned = records.map((r) => ({ ...r }));
  detect.flagEvents(cloned, view.pctl ? { pctl: view.pctl } : {});
  const isEvent = (r) => view.noOpMargin ? r.isEventNoMargin : r.isEvent;
  // Dry Round #4 Fund T2 (20.07.): Firmen-Ebene wie im Hauptpfad — Protokoll
  // par.5 "Kontrolle = Nicht-Event-Firma", nie nur das Event-Quartal.
  const eventFirmCiks = new Set(cloned.filter(isEvent).map((r) => r.cik));
  return {
    events: cloned.filter((r) => isEvent(r) && !excludedEventCiks.has(r.cik)),
    controls: cloned.filter((r) => !eventFirmCiks.has(r.cik)),
  };
}

// ── Matching (§5): kontemporär, SIC2 exakt, Mahalanobis (diag) ≤ CALIPER ─────
const MATCH_DIMS = ['logMcap', 'mom', 'evsPctl'];
function matchDistance(evVars, ctlVars, stats) {
  let d2 = 0;
  for (const d of MATCH_DIMS) {
    if (!Number.isFinite(evVars[d]) || !Number.isFinite(ctlVars[d])) return null;
    const z = (ctlVars[d] - stats[d].m) / stats[d].sd - (evVars[d] - stats[d].m) / stats[d].sd;
    d2 += z * z;
  }
  return Math.sqrt(d2);
}
function buildPairs(events, candidatesByQ) {
  const usedControlPerQ = new Map(); // calQ -> Set(cik)
  const pairs = []; let noMatch = 0;
  for (const ev of events) {
    const eventPool = candidatesByQ.get(ev) || candidatesByQ.get(ev.calQ) || [];
    const pool = eventPool.filter((c) => c.cik !== ev.cik && c.sic2 === ev.sic2
      && c.vars && ev.vars && MATCH_DIMS.every((d) => Number.isFinite(c.vars[d]) && Number.isFinite(ev.vars[d])));
    if (!pool.length) { noMatch++; continue; }
    // Standardisierung über den Pool + Event (je Quartal, je Event-Sektor)
    const stats = {};
    for (const d of MATCH_DIMS) {
      const vals = pool.map((c) => c.vars[d]).concat([ev.vars[d]]);
      const m = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, vals.length - 1)) || 1;
      stats[d] = { m, sd };
    }
    const used = usedControlPerQ.get(ev.calQ) || new Set();
    let best = null, bestD = Infinity;
    for (const c of pool) {
      if (used.has(c.cik)) continue;
      const dist = matchDistance(ev.vars, c.vars, stats);
      if (dist == null) continue;
      if (dist < bestD) { bestD = dist; best = c; }
    }
    if (!best || bestD > CALIPER) { noMatch++; continue; }
    used.add(best.cik); usedControlPerQ.set(ev.calQ, used);
    pairs.push({ ev, ctl: best, dist: +bestD.toFixed(3) });
  }
  return { pairs, noMatch };
}

// ── Cluster-Bootstrap (§8) über SIC2×CalQ ────────────────────────────────────
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function normalCdf(z) { return 0.5 * (1 + erf2(z / Math.SQRT2)); }
function bcaInterval(bootstrapMeans, original, jackknife, alphaLo, alphaHi) {
  const sorted = bootstrapMeans.slice().sort((a, b) => a - b);
  const B = sorted.length;
  const tail = Math.min(1 - 1 / (2 * B), Math.max(1 / (2 * B), sorted.filter((m) => m < original).length / B));
  const z0 = rankIc.invNormalCdf(tail);
  const jackMean = jackknife.reduce((s, v) => s + v, 0) / jackknife.length;
  let num = 0, denBase = 0;
  for (const v of jackknife) {
    const d = jackMean - v;
    num += d ** 3;
    denBase += d ** 2;
  }
  const acceleration = denBase > 0 ? num / (6 * denBase ** 1.5) : 0;
  const adjusted = (alpha) => {
    const za = rankIc.invNormalCdf(alpha);
    return normalCdf(z0 + (z0 + za) / (1 - acceleration * (z0 + za)));
  };
  const quantile = (p) => sorted[Math.min(B - 1, Math.max(0, Math.round(p * (B - 1))))];
  return { lo: quantile(adjusted(alphaLo)), hi: quantile(adjusted(alphaHi)) };
}
function clusterBootstrap(pairDiffs /* [{cluster, calQ, diff}] */, B, seed) {
  const byCluster = new Map();
  for (const p of pairDiffs) { let a = byCluster.get(p.cluster); if (!a) byCluster.set(p.cluster, a = []); a.push(p.diff); }
  const clusters = Array.from(byCluster.values());
  const nC = clusters.length;
  const meanOf = (cs) => { let s = 0, n = 0; for (const c of cs) for (const d of c) { s += d; n++; } return n ? s / n : 0; };
  const mean0 = meanOf(clusters);
  // N_eff über zeit-geordnete Cluster-Mittel (Kendall-korrigiert via rank-ic.nEff)
  const clusterMeansChrono = Array.from(byCluster.entries())
    .map(([k, v]) => ({ calQ: k.split('|')[1], m: v.reduce((s, d) => s + d, 0) / v.length }))
    .sort((a, b) => (a.calQ < b.calQ ? -1 : 1)).map((x) => x.m);
  const nEff = rankIc.nEff(clusterMeansChrono);
  const rnd = lcg(seed);
  const means = new Array(B);
  for (let b = 0; b < B; b++) {
    const sample = [];
    for (let i = 0; i < nC; i++) sample.push(clusters[Math.floor(rnd() * nC)]);
    means[b] = meanOf(sample);
  }
  let pRaw = Math.max(1 / B, means.filter((m) => m <= 0).length / B);
  // E-20260719-1 sinngemäß: Verbreiterung um sqrt(nC/nEff), nur abschwächend.
  const f = Math.sqrt(nC / Math.max(1e-9, nEff));
  let p = pRaw;
  if (f > 1 && p < 0.5) {
    const z = rankIc.invNormalCdf(1 - p);
    p = Math.min(0.5, Math.max(pRaw, 1 - (0.5 * (1 + erf2((z / f) / Math.SQRT2)))));
  }
  const jackknife = nC > 1
    ? clusters.map((_, omitted) => meanOf(clusters.filter((__, i) => i !== omitted)))
    : [mean0];
  const bca = bcaInterval(means, mean0, jackknife, 0.05, 0.95);
  const lo = mean0 - (mean0 - bca.lo) * f, hi = mean0 + (bca.hi - mean0) * f;
  return { mean: mean0, nClusters: nC, nEff: +(+nEff).toFixed(2), p: +p.toFixed(5), ci90: { lo: +lo.toFixed(4), hi: +hi.toFixed(4), method: 'BCa' } };
}
function erf2(x) {
  const sign = x < 0 ? -1 : 1; const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, pp = 0.3275911;
  const t = 1 / (1 + pp * ax);
  return sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax));
}

function evaluatePairOutcomes(pairs, view, barsOf) {
  const diffs = [];
  let evOutcomeMissing = 0, ctlOutcomeMissing = 0;
  for (const p of pairs) {
    const opts = { kSigma: view.kSigma, entryLag: view.entryLag };
    const eo = firstPassage(barsOf(p.ev.ticker), p.ev.filed, opts);
    const co = firstPassage(barsOf(p.ctl.ticker), p.ev.filed, opts);
    if (eo.status !== 'ok') evOutcomeMissing++;
    if (co.status !== 'ok') ctlOutcomeMissing++;
    if (eo.status === 'ok' && co.status === 'ok') {
      diffs.push({ cluster: p.ev.sic2 + '|' + p.ev.calQ, calQ: p.ev.calQ, diff: (eo.upperFirst ? 1 : 0) - (co.upperFirst ? 1 : 0) });
    }
  }
  const pairsAttempted = pairs.length;
  const eventOutcomeMissRate = pairsAttempted ? evOutcomeMissing / pairsAttempted : 0;
  const controlOutcomeMissRate = pairsAttempted ? ctlOutcomeMissing / pairsAttempted : 0;
  return {
    diffs, pairsAttempted, pairsComplete: diffs.length, evOutcomeMissing, ctlOutcomeMissing,
    eventOutcomeMissRate, controlOutcomeMissRate,
    outcomeBalanceDelta: Math.abs(eventOutcomeMissRate - controlOutcomeMissRate),
  };
}

function assessBalance(beforeDelta, outcomeDelta, threshold = BALANCE_GATE_PP) {
  const maxDelta = Math.max(beforeDelta || 0, outcomeDelta || 0);
  return { passed: maxDelta <= threshold, maxDelta };
}

// ── estimable-Gate, fail closed (Urteile vom 30.08.2026) ─────────────────────
// ZWEI Gerichte fanden dieselbe Stelle unabhaengig voneinander:
//   _COURT-B2-2026-08-30.md    K3 Punkt 7 / R4 / Abhilfe A3 (3:0, blockierend)
//   _COURT-FORM25-LABEL-...md  Auflage B5 (2 von 3 Richtern am Objekt gefunden)
// Der alte Test lautete `S.estimable === false` und war damit fail-OPEN: ein
// FEHLENDES Feld, `null`, der String 'true' oder `{estimable:true, mean:null}`
// machten die Shumway-View still "auswertbar", das Pflicht-Gate im Verdikt lief
// ins Leere und der POSITIV-Pfad stand offen. Das ist die teure Richtung — ein
// POSITIV, das ein Pflicht-Gate uebersprungen hat, behauptet etwas; ein zu
// Unrecht gekapptes POSITIV behauptet nichts.
// Deshalb jetzt umgekehrt: NUR ein vollstaendig belegtes `=== true` zaehlt,
// JEDER andere Zustand — einschliesslich eines Fehlers IM Gate selbst — ergibt
// estimable=false und kappt ein POSITIV. Ein NULL bleibt davon unberuehrt
// (par.8: NULL braucht das Veto nicht); genau das ist der Konstruktionspunkt
// des Gates und keine Nachlaessigkeit.
// K3 Punkt 7 verlangt zusaetzlich Intervallgrenzen und Breitenpruefung
// MASCHINELL: eine "schaetzbare" View ohne bezifferte Schranke ist keine.
// ponytail: die Unbrauchbarkeits-Schwelle (10 pp) wird hier NICHT hartkodiert —
// sie ist praeregistrierungspflichtig (5.B Punkt 5). Das Gate liefert die
// Breite maschinell; der Schwellenvergleich kommt mit der B2-Praereg dazu.
function shumwayEstimableGate(S) {
  try {
    if (!S || typeof S !== 'object') return { estimable: false, reason: 'GATE_NO_VIEW' };
    if (S.estimable !== true) {
      return {
        estimable: false,
        reason: S.estimable === false ? (S.reason || 'NOT_ESTIMABLE') : 'GATE_ESTIMABLE_NOT_TRUE',
      };
    }
    if (!Number.isFinite(S.mean)) return { estimable: false, reason: 'GATE_NO_POINT_ESTIMATE' };
    const ci = S.ci90;
    if (!ci || typeof ci !== 'object' || !Number.isFinite(ci.lo) || !Number.isFinite(ci.hi)) {
      return { estimable: false, reason: 'GATE_NO_INTERVAL_BOUNDS' };
    }
    const width = ci.hi - ci.lo;
    if (!Number.isFinite(width) || width < 0) return { estimable: false, reason: 'GATE_WIDTH_NOT_COMPUTABLE' };
    return { estimable: true, reason: 'OK', width, widthPp: +(100 * width).toFixed(1) };
  } catch (e) {
    // Ein Fehler IM Gate darf nie zum Durchlassen fuehren (R4: fail closed).
    return { estimable: false, reason: 'GATE_INTERNAL_ERROR: ' + ((e && e.message) || e) };
  }
}

// Verdikt-Kette (§8) — aus main() herausgeloest, WORTGLEICH, damit der Waechter
// die echte Entscheidung fuettern kann statt einer Nachbildung. Auflage B5
// verlangt woertlich den Nachweis, dass eine View OHNE `estimable`-Feld KEIN
// POSITIV erzeugen kann; das ist an einer Kopie der Logik nicht beweisbar.
function decideVerdict(famResults, balanceDelta) {
  const H = famResults.haupttest || {};
  const powerOk = H.nEff != null && H.nEff >= MIN_NEFF_CLUSTERS;
  const outcomeDelta = H.outcomeBalanceDelta || 0;
  const balance = assessBalance(balanceDelta, outcomeDelta);
  const balanceOk = balance.passed;
  // Option E (fail closed, Duell-Ruling 20.07.): eine nicht schaetzbare
  // Shumway-View darf ein POSITIV nicht durchwinken (das waere ein still
  // uebersprungenes Pflicht-Gate) — sie kappt es auf 'nicht belastbar'.
  // Ein NULL bleibt ein gueltiges Ergebnis (par.8: NULL braucht das Veto nicht).
  const S = famResults.shumway || {};
  const shumwayGate = shumwayEstimableGate(S);
  const shumwayNotEstimable = !shumwayGate.estimable;
  const shumwayVeto = shumwayGate.estimable && S.mean < 0 && H.mean > 0;
  const positivBlockedByGate = !!(H.bySignificant && H.mean > 0 && shumwayNotEstimable);
  let verdict;
  if (!powerOk) verdict = 'unterpowert — kein Urteil (N_eff<' + MIN_NEFF_CLUSTERS + ' Cluster)';
  else if (!balanceOk) verdict = 'nicht belastbar unter Attrition (Balance-Gate)';
  else if (shumwayVeto) verdict = 'nicht belastbar unter Attrition (Shumway-Veto: Vorzeichen kippt)';
  else if (positivBlockedByGate) verdict = 'nicht belastbar unter Attrition (Shumway-View nicht auswertbar — keine unabhaengigen Delisting-Labels, Addendum 20260720)';
  else if (H.bySignificant && H.mean > 0) verdict = 'POSITIV: Haupttest überlebt BY + Gates';
  else verdict = 'NEGATIV/NULL: kein BY-signifikanter Effekt (gültiges Ergebnis)';
  return { verdict, powerOk, balanceOk, balance, shumwayGate, shumwayVeto, positivBlockedByGate };
}

// T204 measurement seam: tests call only this byte-preserving writer with
// synthetic reports. The confirmatory main path is never needed to prove that
// either report publication site is reachable.
function writeValidationReport(target, report) {
  writeFileAtomic(target, JSON.stringify(report, null, 2));
}

module.exports = {
  firstPassage, matchVarsAt, buildPairs, clusterBootstrap, evSales, idxOnOrAfter,
  buildEventDatedCandidatePools, selectViewRecords, matchDistance, bcaInterval,
  evaluatePairOutcomes, assessBalance, shumwayEstimableGate, decideVerdict,
  ensureSubmissions, sic2Of, loadPriceSeries,
  writeValidationReport,
  _const: { VAL_START, VAL_END, DISC_END, K_SIGMA, TIMEOUT_TD, CALIPER, BALANCE_GATE_PP, MIN_NEFF_CLUSTERS, BY_Q },
};

// ── Hauptlauf (der EINE konfirmatorische Lauf) ───────────────────────────────
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log('[b1-validate] Protokoll Tag 389 (7b20e750…cf0f79) — ' + (dryRun ? 'DRY-RUN (Gates/Matching, keine Outcomes)' : 'KONFIRMATORISCHER LAUF'));
  const store = secPit.openStore();
  const allCiks = detect.listAllCiks();

  // 1) Events Validation + Discovery-Ausschlussliste
  console.log('[b1-validate] Erkennung Validation-Ära …');
  const val = detect.collectRecords(store, { eraStart: VAL_START, eraEnd: VAL_END, ciks: allCiks });
  detect.flagEvents(val.records);
  console.log('[b1-validate] Erkennung Discovery-Ausschluss …');
  const disc = detect.collectRecords(store, { eraStart: '1900-01-01', eraEnd: DISC_END, ciks: allCiks });
  detect.flagEvents(disc.records);
  const discEventCiks = new Set(disc.records.filter((r) => r.isEvent).map((r) => r.cik));
  const events = val.records.filter((r) => r.isEvent && !discEventCiks.has(r.cik));
  // Dry Round #4 Fund T2 (20.07.): Protokoll par.5 verlangt "Kontrolle =
  // Nicht-Event-FIRMA" (Firmen-Ebene; par.6 formuliert "Zeit- UND Firmen-
  // Trennung" explizit). Der fruehere cik|calQ-Ausschluss liess Nicht-Event-
  // QUARTALE von Event-Firmen als Kontrollen zu - deren Post-Event-Drift
  // (PEAD, par.9) hob die Kontroll-Oben-zuerst-Rate und attenuierte die
  // Primaerdifferenz Richtung 0 (konservative Verzerrung, entwertet ein NULL).
  const eventFirmCiks = new Set(val.records.filter((r) => r.isEvent).map((r) => r.cik));
  const nonEvents = val.records.filter((r) => !eventFirmCiks.has(r.cik));
  // Bless-Gate-P1 zu Tag 408: der Firmen-Ausschluss gilt NUR fuer den
  // Kontroll-Pool. Die Nicht-Event-Quartale der Event-Firmen bleiben in der
  // ANREICHERUNGS-Basis verfuegbar — die P75-/ohneOpMargin-Views koennen dort
  // legitime Alternativ-Events flaggen; ohne diese Basis verwarf enrichedByKey
  // sie still (.filter(Boolean)) und View-p/BY haetten sich verschoben.
  const eventFirmOthers = val.records.filter((r) => eventFirmCiks.has(r.cik) && !r.isEvent);
  console.log('[b1-validate] Events=' + val.records.filter((r) => r.isEvent).length
    + ' davon nach Discovery-Ausschluss=' + events.length + ' · Nicht-Event-Records=' + nonEvents.length
    + ' · Event-Firmen-Restquartale (nur Anreicherung/Views)=' + eventFirmOthers.length);

  // 2) Ticker/SIC/Preise/Match-Variablen
  const tickerByCik = new Map();
  for (const [tk, cik] of secPit.loadTickerMap().entries()) if (!tickerByCik.has(cik)) tickerByCik.set(cik, tk);
  const needCiks = Array.from(new Set([...events, ...nonEvents, ...eventFirmOthers].filter((r) => tickerByCik.has(r.cik)).map((r) => r.cik)));
  await ensureSubmissions(needCiks, process.env.SEC_CONTACT);

  // Caches: factsForCik parst ~100 KB–5 MB JSON — NIE pro Record, nur pro CIK.
  // WICHTIG (OOM-Lektion, Exit 134): unbegrenzt gecacht sprengen ~2.400 geparste
  // Dateien den V8-Heap. Die Records sind CIK-sequentiell (collectRecords baut
  // sie pro CIK am Stück) — ein kleiner LRU (16) deckt das Zugriffs-Muster
  // vollständig und hält den Heap flach. Preis-Serien analog pro Ticker.
  const mkLru = (max) => {
    const m = new Map();
    return { get(k, mk) {
      if (m.has(k)) { const v = m.get(k); m.delete(k); m.set(k, v); return v; }
      const v = mk();
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
      return v;
    } };
  };
  const factsLru = mkLru(16), barsLru = mkLru(16);
  const factsOf = (cik) => factsLru.get(cik, () => { try { return store.factsForCik(cik); } catch (_) { return null; } });
  const barsOf = (tk) => barsLru.get(tk, () => loadPriceSeries(tk));
  const enrich = (r) => {
    const ticker = tickerByCik.get(r.cik) || null;
    r.ticker = ticker; r.sic2 = sic2Of(r.cik);
    if (!ticker || !r.sic2) return r;
    // OOM-Lektion: bars NIE an Records hängen (2,4k Ticker × ~10k Bar-Objekte
    // wären GBs) — transient über den LRU beziehen, Outcome-Phase lädt erneut.
    const bars = barsOf(ticker);
    r.hasBars = !!bars;
    if (!bars) return r;
    const facts = factsOf(r.cik);
    const shares = facts ? secPit.sharesHistory(facts, { asOf: r.filed }) : [];
    const mv = matchVarsAt(bars, r.filed, shares);
    if (!mv) return r;
    const evs = facts ? evSales(facts, mv.mcap, r.filed) : null;
    r.vars = { logMcap: mv.mcap ? Math.log(mv.mcap) : NaN, mom: mv.mom, evsRaw: evs };
    return r;
  };
  console.log('[b1-validate] Anreicherung (Ticker/SIC/Preise/Variablen) …');
  events.forEach(enrich); nonEvents.forEach(enrich);
  // Bless-Gate-P2 zu Tag 409: Restquartale nur LEICHT anreichern (Ticker/SIC,
  // kein bars/facts-Load) — hasBars/vars der tatsaechlich ausgewaehlten
  // Alternativ-View-Events setzt buildEventDatedCandidatePools ohnehin frisch
  // zum jeweiligen Eventdatum; der usable-Filter der Views laeuft DANACH.
  eventFirmOthers.forEach((r) => { r.ticker = tickerByCik.get(r.cik) || null; r.sic2 = sic2Of(r.cik); });
  const datedDeps = { factsOf, barsOf }, datedVarsCache = new Map();
  const mainCandidatePools = buildEventDatedCandidatePools(events, nonEvents, datedDeps, datedVarsCache);

  // Balance-Gate-Zählung: Preis-/Substrat-Verfügbarkeit je Gruppe
  const usable = (r) => !!(r.ticker && r.sic2 && r.hasBars && r.vars);
  const evUsable = events.filter(usable), evMissRate = events.length ? 1 - evUsable.length / events.length : 0;
  const ctlCandidates = nonEvents.filter(usable);
  const ctlMissRate = nonEvents.length ? 1 - ctlCandidates.length / nonEvents.length : 0;
  const balanceDelta = Math.abs(evMissRate - ctlMissRate);
  console.log('[b1-validate] Fehlquoten: Event ' + (100 * evMissRate).toFixed(1) + ' % · Kontrolle ' + (100 * ctlMissRate).toFixed(1)
    + ' % · Δ=' + (100 * balanceDelta).toFixed(1) + ' pp (Gate ' + (100 * BALANCE_GATE_PP) + ' pp)');

  // 3) Matching
  const { pairs, noMatch } = buildPairs(evUsable, mainCandidatePools);
  console.log('[b1-validate] Paare=' + pairs.length + ' · ohne Caliper-Match=' + noMatch);

  const report = {
    generatedAt: new Date().toISOString(), protocol: 'protocol/b1-registered-20260719.md', protocolSha256: '7b20e750261ca5a6ede207064275d3934f11408565865477baced74ee0cf0f79',
    era: { validation: [VAL_START, VAL_END], lockboxUntouched: true }, dryRun,
    detection: {
      counters: val.counters,
      eventsRaw: val.records.filter((r) => r.isEvent).length,
      // Kreuz-Review-Claim-5-Fix (21.07.): getrennt ausweisen — discEventCiks.size ist die
      // CIK-Anzahl mit Discovery-Event (Firmen-Ausschluss §6), NICHT die Zahl entfernter Events.
      discoveryExcludedCiks: discEventCiks.size,
      discoveryExcludedEvents: val.records.filter((r) => r.isEvent).length - events.length,
      events: events.length,
      nonEventRecords: nonEvents.length,
    },
    missingness: { eventMissRate: +evMissRate.toFixed(3), controlMissRate: +ctlMissRate.toFixed(3), balanceDeltaPp: +(100 * balanceDelta).toFixed(1), balanceGatePassed: balanceDelta <= BALANCE_GATE_PP },
    // §8 Z.101 deskriptive Survivorship-Bilanz auf der VOLLEN companyfacts-CIK-Population
    // (inkl. tote CIKs) — „null Entscheidungsgewalt" (§7 Z.84-85); nur Ausweis. Kreuz-Review-P2.
    survivorship: {
      ciksTotal: val.counters.ciksTotal, ciksParsed: val.counters.ciksParsed,
      ciksNoRevenue: val.counters.ciksNoRevenue,
      firmQuartersEvaluated: val.counters.firmQuartersEvaluated, evaluable: val.counters.evaluable,
    },
    matching: { pairs: pairs.length, noCaliperMatch: noMatch },
  };

  if (dryRun) {
    writeValidationReport(OUT_BASE + '-dryrun.json', report);
    console.log('[b1-validate] DRY-RUN-Report -> ' + OUT_BASE + '-dryrun.json (keine Outcomes gerechnet)');
    store.close(); return;
  }

  // 4) Outcomes + Familie m=6 (§7)
  const views = [
    { key: 'haupttest', kSigma: K_SIGMA, entryLag: 1, evFilter: (r) => r.isEvent },
    { key: 'p75', kSigma: K_SIGMA, entryLag: 1, pctl: 0.75 },
    { key: 'sigma15', kSigma: K_SIGMA_ROBUST, entryLag: 1 },
    { key: 'ohneOpMargin', kSigma: K_SIGMA, entryLag: 1, noOpMargin: true },
    { key: 'tplus5', kSigma: K_SIGMA, entryLag: 5 },
    // Dry Round #2 T2-2 / Option E (fail closed): die praeregistrierte
    // Shumway-View ist ohne unabhaengige Delisting-Labels NICHT SCHAETZBAR
    // (Details protocol/b1-addendum-20260720-shumway.md). Sie bleibt in der
    // m=6-Familie mit der bestehenden "unmessbar = p=1"-Konvention und kann
    // nie BY-signifikant werden; ein POSITIV-Verdikt ist ohne auswertbare
    // Shumway-View strukturell nicht erreichbar (par.8, fail closed).
    { key: 'shumway', kSigma: K_SIGMA, entryLag: 1, notEstimable: 'NOT_ESTIMABLE_NO_DELISTING_LABELS' },
  ];
  const famResults = {};
  // Bless-Gate-P1 zu Tag 408: inkl. eventFirmOthers — Alternativ-View-Events
  // von Event-Firmen duerfen nicht still am Lookup scheitern.
  const enrichedByKey = new Map([...events, ...nonEvents, ...eventFirmOthers].map((r) => [r.cik + '|' + r.end, r]));
  for (const v of views) {
    if (v.notEstimable) {
      famResults[v.key] = {
        estimable: false, reason: v.notEstimable, p: 1, mean: null, n: 0,
        pairsAttempted: 0, pairsComplete: 0, evOutcomeMissing: 0, ctlOutcomeMissing: 0,
        eventOutcomeMissRate: 0, controlOutcomeMissRate: 0,
        outcomeBalanceDelta: 0, outcomeBalanceDeltaPp: 0,
      };
      continue;
    }
    // Event-Menge je View (P75/ohneOpMargin verändern die Auswahl; Paare neu bilden)
    let evSet = evUsable, prs = pairs;
    if (v.pctl || v.noOpMargin) {
      const selected = selectViewRecords(val.records, v, discEventCiks);
      evSet = selected.events.map((r) => enrichedByKey.get(r.cik + '|' + r.end)).filter(Boolean);
      const viewControls = selected.controls.map((r) => enrichedByKey.get(r.cik + '|' + r.end)).filter(Boolean);
      const viewPools = buildEventDatedCandidatePools(evSet, viewControls, datedDeps, datedVarsCache);
      evSet = evSet.filter(usable);
      prs = buildPairs(evSet, viewPools).pairs;
    }
    const outcome = evaluatePairOutcomes(prs, v, barsOf);
    const boot = outcome.diffs.length ? clusterBootstrap(outcome.diffs, B_BOOT, BOOT_SEED) : null;
    famResults[v.key] = {
      pairsAttempted: outcome.pairsAttempted, pairsComplete: outcome.pairsComplete,
      evOutcomeMissing: outcome.evOutcomeMissing, ctlOutcomeMissing: outcome.ctlOutcomeMissing,
      eventOutcomeMissRate: +outcome.eventOutcomeMissRate.toFixed(3),
      controlOutcomeMissRate: +outcome.controlOutcomeMissRate.toFixed(3),
      outcomeBalanceDelta: outcome.outcomeBalanceDelta,
      outcomeBalanceDeltaPp: +(100 * outcome.outcomeBalanceDelta).toFixed(1),
      ...boot,
    };
  }
  // BY über m=6 (unmessbare p=1)
  const keys = views.map((v) => v.key);
  const pvals = keys.map((k) => (famResults[k] && Number.isFinite(famResults[k].p) ? famResults[k].p : 1));
  const sig = rankIc.benjaminiYekutieli(pvals, BY_Q);
  keys.forEach((k, i) => { famResults[k].bySignificant = sig[i]; });

  // 5) Verdikt (§8)
  const D = decideVerdict(famResults, balanceDelta);
  const { verdict, powerOk, balanceOk, balance, shumwayGate, shumwayVeto, positivBlockedByGate } = D;
  const H = famResults.haupttest || {};
  // Laut, nicht still: ein gekapptes POSITIV ist der Fall, der frueher stumm
  // durchfiel. Er gehoert in stderr, nicht nur in die JSON-Datei.
  if (positivBlockedByGate) {
    console.error('[b1-validate] GATE FAIL-CLOSED: POSITIV gekappt — Shumway-View nicht auswertbar (Grund: '
      + shumwayGate.reason + '). Urteile _COURT-B2-2026-08-30 (K3/R4) und _COURT-FORM25-LABEL-2026-08-30 (B5).');
  }
  report.family = famResults;
  report.missingness.outcome = Object.fromEntries(keys.map((k) => [k, {
    pairsAttempted: famResults[k].pairsAttempted,
    evOutcomeMissing: famResults[k].evOutcomeMissing,
    ctlOutcomeMissing: famResults[k].ctlOutcomeMissing,
    eventMissRate: famResults[k].eventOutcomeMissRate,
    controlMissRate: famResults[k].controlOutcomeMissRate,
    balanceDeltaPp: famResults[k].outcomeBalanceDeltaPp,
  }]));
  report.missingness.balanceGatePassed = balanceOk;
  report.gates = {
    powerOk, nEffClusters: H.nEff || null, balanceOk,
    balanceDeltaBeforePp: +(100 * balanceDelta).toFixed(1),
    balanceDeltaOutcomePp: H.outcomeBalanceDeltaPp || 0,
    balanceDeltaMaxPp: +(100 * balance.maxDelta).toFixed(1),
    shumwayVeto: !!shumwayVeto,
    shumwayEstimable: shumwayGate.estimable,
    shumwayGateReason: shumwayGate.reason,
    shumwayIntervalWidthPp: shumwayGate.widthPp != null ? shumwayGate.widthPp : null,
    positivBlockedByGate,
  };
  report.verdict = verdict;

  writeValidationReport(OUT_BASE + '.json', report);
  console.log('[b1-validate] VERDIKT: ' + verdict);
  console.log('[b1-validate] Haupttest: pairs=' + (H.pairsComplete || 0) + ' meanDiff=' + (H.mean != null ? H.mean : '—')
    + ' CI90=[' + (H.ci90 ? H.ci90.lo + ',' + H.ci90.hi : '—') + '] p=' + (H.p != null ? H.p : '—') + ' nEff=' + (H.nEff || '—'));
  console.log('[b1-validate] Report -> ' + OUT_BASE + '.json');
  store.close();
}

if (require.main === module) main().catch((e) => { console.error('[b1-validate] FATAL: ' + (e && e.stack || e)); process.exit(1); });
