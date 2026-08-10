#!/usr/bin/env node
'use strict';
// TASK 0.10 (Schutz-Kadenzen) — WOCHEN-Wert-Spot-Check.
// Macht das "fehlerfrei"-Versprechen (Nordstern/H4) LAUFEND messbar: vergleicht N zufaellige
// angezeigte Kennwerte gegen den Yahoo-Rohwert und wird ROT (exit 1) bei struktureller Korruption.
//
// ⚠ WAEHRUNGS-INVARIANTER VERGLEICH (Court-Fix 0.10): unsere Snapshot-Werte sind USD-normalisiert
// (_convertSnapshotToUSD), Yahoo liefert LOKAL-/Reporting-Waehrung. Ein direkter marketCap-Vergleich
// wuerde JEDEN nicht-USD-Ticker (CNY/JPY/KRW/…) faelschlich als "Leak" melden -> woechentlich Cry-Wolf.
// Deshalb vergleichen wir das DIMENSIONSLOSE VERHAELTNIS marketCap/annualRev auf beiden Seiten:
// Zaehler und Nenner sind je Seite in DERSELBEN Waehrung -> das Verhaeltnis ist waehrungsinvariant.
// Es faengt trotzdem die dokumentierte Korruptionsklasse (Einzelachsen-Waehrungs-Leak, 100x/1000x-Skala
// auf EINER Achse, Bug 1 Audit 2026-07-03: pence-Leak 100x, USD/Reporting-Leak 1000x) — die kippt das
// Verhaeltnis um Zehnerpotenzen. BLINDER FLECK (bewusst, ponytail): eine UNIFORME Korruption BEIDER
// Achsen um denselben Faktor kuerzt sich raus; die faengt der separate fxConversionFailed-Pfad
// (pull-yahoo.js) + der 0.8-Waechter ab. Upgrade-Pfad: FX-normalisierter Absolut-Vergleich, falls
// je ein uniformer Both-Axis-Bug beobachtet wird.
//
// TOLERANZ: |log10(snapRatio / yahooRatio)| > TOL_LOG10 (0.5 = Faktor 3.16) = MISMATCH pro Ticker.
//   Marktbewegung bewegt EIN Verhaeltnis nie um Faktor 3; ein Leak IMMER (>=100x). Rot erst ab >=2
//   Mismatches (1 Ausreisser = evtl. Yahoo-Datenmacke), und nur bei genug vergleichbaren Tickern.
// TRANSIENT: Yahoo-429/timeout/leer -> "unreachable" (NIE Mismatch), 1x Retry. >5/8 unreachable ODER
//   <3 vergleichbar -> "inconclusive" (::warning::, exit 0) — Yahoos Tagesform macht nie rot.
//
// Usage: node scripts/value-spot-check.js [--n 8] [--snapshots snapshots] [--seed <int>]
//        node scripts/value-spot-check.js --selftest
const fs = require('fs');
const path = require('path');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const TOL_LOG10 = 0.5;      // Faktor 3.16
const MIN_COMPARABLE = 3;   // < so viele vergleichbare Ticker -> inconclusive
const RED_MISMATCHES = 2;   // >= so viele Mismatches -> rot

// --- reine Kernlogik (TDD, kein I/O) ---

// Verhaeltnis marketCap/annualRev; null wenn eine Groesse fehlt/<=0 (nicht vergleichbar).
function ratio(marketCap, revenue) {
  const mc = Number(marketCap), rev = Number(revenue);
  if (!Number.isFinite(mc) || !Number.isFinite(rev) || mc <= 0 || rev <= 0) return null;
  return mc / rev;
}

// Vergleich EINES Tickers -> 'match' | 'mismatch' | 'skip'. Waehrungsinvariant (nur Verhaeltnisse).
function evalTicker(snapMc, snapRev, yahooMc, yahooRev) {
  const rs = ratio(snapMc, snapRev);
  const ry = ratio(yahooMc, yahooRev);
  if (rs === null || ry === null) return { status: 'skip', reason: 'fehlender/nicht-positiver Wert' };
  const logDiff = Math.abs(Math.log10(rs / ry));
  return { status: logDiff > TOL_LOG10 ? 'mismatch' : 'match', logDiff: +logDiff.toFixed(3), snapRatio: +rs.toFixed(4), yahooRatio: +ry.toFixed(4) };
}

// Aggregiert die Per-Ticker-Ergebnisse -> {status, red, ...}. results: [{ticker,eval|unreachable}]
function classify(results) {
  const unreachable = results.filter(r => r.unreachable).length;
  const evals = results.filter(r => r.eval).map(r => ({ ticker: r.ticker, ...r.eval }));
  const comparable = evals.filter(e => e.status !== 'skip');
  const mismatches = comparable.filter(e => e.status === 'mismatch');
  // Yahoo global gedrosselt / zu wenig Vergleichbare -> kein Urteil (nie rot).
  if (unreachable > results.length - 3 || comparable.length < MIN_COMPARABLE) {
    return { status: 'inconclusive', red: false, unreachable, comparable: comparable.length, mismatches: mismatches.length, mismatchTickers: mismatches.map(m => m.ticker) };
  }
  const red = mismatches.length >= RED_MISMATCHES;
  return { status: red ? 'mismatch' : 'ok', red, unreachable, comparable: comparable.length, mismatches: mismatches.length, mismatchTickers: mismatches.map(m => m.ticker) };
}

// Deterministische Seed-Auswahl (ISO-Woche als Default-Seed -> woechentlich rotierend, reproduzierbar).
function isoWeekSeed(d) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return dt.getUTCFullYear() * 100 + week;
}
// mulberry32 — kleiner deterministischer PRNG (kein Math.random, damit reproduzierbar/seed-stabil).
function seededPick(arr, n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

// Yahoo-Rohwerte fuer ein Symbol (I/O, isoliert). Nutzt yahoo-finance2 (in CI bewiesen, Crumb-Auth).
// v3.x ist eine KLASSE -> einmal instanziieren (wie pull-yahoo.js: new YahooFinance({...})).
let _yf = null;
function yfInstance() {
  if (_yf) return _yf;
  const YahooFinance = require('yahoo-finance2').default;
  _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'], validation: { logErrors: false, logOptionsErrors: false } });
  return _yf;
}
async function fetchYahoo(symbol) {
  const yf = yfInstance();
  const num = (v) => (v && typeof v === 'object' && 'raw' in v) ? v.raw : v; // {raw} oder Zahl
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // financialData.totalRevenue (TTM, LIVE-Modul) statt incomeStatementHistory — letzteres liefert
      // laut yahoo-finance2 seit Nov 2024 fast keine Daten (Smoke-Test 0.10 bestaetigt: stale -> Falsch-
      // Mismatches). TTM-vs-juengstes-Annual differiert <1 Jahr Wachstum, vernachlaessigbar bei Faktor-3.16-Toleranz.
      const q = await yf.quoteSummary(symbol, { modules: ['summaryDetail', 'financialData'] });
      const mc = num(q && q.summaryDetail && q.summaryDetail.marketCap);
      const rev = num(q && q.financialData && q.financialData.totalRevenue);
      return { mc, rev };
    } catch (e) {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 3000)); continue; }
      return { unreachable: true, err: e && e.message };
    }
  }
}

function readSnapshot(dir, file) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return { ticker: (s.meta && s.meta.ticker) || file.replace(/\.json$/, ''), mc: s.marketCap && s.marketCap.value, rev: s.annual && s.annual.annualRev && s.annual.annualRev[0] && s.annual.annualRev[0].value };
  } catch (e) { return null; }
}

async function run(io = {}) {
  const exit = io.exit || process.exit;
  const error = io.error || console.error;
  const argv = process.argv;
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const n = parseInt(get('--n', '8'), 10);
  const snapDir = get('--snapshots', 'snapshots');
  const seed = parseInt(get('--seed', String(isoWeekSeed(new Date()))), 10);

  let files = [];
  try { files = fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)); }
  catch (e) { error(`::error::value-spot-check — Snapshot-Ordner ${snapDir} nicht lesbar (${e.message}); Pruefer blind.`); exit(1); return; }
  if (files.length < MIN_COMPARABLE) { error(`::warning::MESSAUSFALL: value-spot-check — nur ${files.length} Snapshots; keine Aussage zur Werte-Qualitaet.`); exit(0); return; }

  const picked = seededPick(files, Math.min(n, files.length), seed);
  const results = [];
  for (const f of picked) {
    const snap = readSnapshot(snapDir, f);
    if (!snap) { results.push({ ticker: f, unreachable: true }); continue; }
    const y = await fetchYahoo(snap.ticker);
    if (!y || y.unreachable) { results.push({ ticker: snap.ticker, unreachable: true }); continue; }
    const ev = evalTicker(snap.mc, snap.rev, y.mc, y.rev);
    results.push({ ticker: snap.ticker, eval: ev });
  }

  const verdict = classify(results);
  for (const r of results) {
    if (r.unreachable) console.log(`  ${r.ticker}: unreachable`);
    else console.log(`  ${r.ticker}: ${r.eval.status}${r.eval.logDiff != null ? ` (log10Δ=${r.eval.logDiff}, snapR=${r.eval.snapRatio}, yR=${r.eval.yahooRatio})` : ''}`);
  }
  const line = `value-spot-check: status=${verdict.status} comparable=${verdict.comparable} mismatches=${verdict.mismatches} unreachable=${verdict.unreachable}${verdict.mismatchTickers.length ? ' [' + verdict.mismatchTickers.join(',') + ']' : ''} (seed=${seed})`;
  if (verdict.red) {
    console.error(`::error::WERT-SPOT-CHECK ROT — ${line}. >=${RED_MISMATCHES} Ticker zeigen strukturelle Wert-Abweichung >Faktor 3.16 im dimensionslosen mcap/rev-Verhaeltnis (Waehrungs-Leak/Skalen-Bug). Ticker+Werte oben.`);
    exit(1);
    return;
  }
  if (verdict.status === 'inconclusive') console.log(`::warning::${line} — kein Urteil (Yahoo gedrosselt/zu wenig Vergleichbare). Nicht rot.`);
  else console.log(`OK — ${line}.`);
  exit(0);
}

async function runCli(main = run, io = {}) {
  const exit = io.exit || process.exit;
  const error = io.error || console.error;
  try { await main(io); }
  catch (e) {
    error(`::error::value-spot-check crashed (${e && e.message}) — Pruefer abgestuerzt.`);
    exit(1);
  }
}

// --- runnable self-check: node scripts/value-spot-check.js --selftest ---
async function selftest() {
  const assert = require('node:assert/strict');
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.error('FAIL   ' + n + '\n       ' + e.message); } };

  // ⭐ WAEHRUNGS-NEGATIVKONTROLLE (der Court-Blocker): 000001.SZ ist CNY-Reporter, unser Snapshot
  // ist USD-normalisiert (mc 30.95B USD, rev 19.3B USD), Yahoo liefert CNY-Roh (mc ~222B, rev ~139B).
  // Absoluter marketCap-Vergleich waere Faktor ~7 daneben (CNY/USD) = falsch-rot. Das dimensionslose
  // Verhaeltnis ist auf BEIDEN Seiten ~1.60 -> MATCH. Beweist: gesunde nicht-USD-Daten -> nie rot.
  t('CNY-Reporter mit korrekter USD-Konvertierung -> MATCH (kein Waehrungs-Falsch-Rot)', () => {
    const e = evalTicker(30.95e9, 19.3e9, 222e9, 139e9); // snapR 1.604, yR 1.597
    assert.equal(e.status, 'match', `erwartet match, war ${e.status} (log10Δ=${e.logDiff})`);
  });
  t('JPY-Reporter (Faktor ~150 CCY) korrekt konvertiert -> MATCH', () => {
    // snap USD: mc 15B, rev 10B -> 1.5 ; Yahoo JPY: mc 2250B, rev 1500B -> 1.5
    assert.equal(evalTicker(15e9, 10e9, 2250e9, 1500e9).status, 'match');
  });
  // POSITIVKONTROLLEN: echte Einzelachsen-Korruption MUSS gefangen werden.
  t('annualRev 100x-pence-Leak (nur eine Achse) -> MISMATCH', () => {
    // Snapshot korrekt (mc 30B, rev 20B -> 1.5), aber Yahoo-Rev leakt 100x zu klein via falsche Einheit:
    // simuliert als unsere Rev 100x zu GROSS ggue Yahoo -> Verhaeltnisse driften um 100x.
    const e = evalTicker(30e9, 20e9 * 100, 30e9, 20e9);
    assert.equal(e.status, 'mismatch', `erwartet mismatch, war ${e.status}`);
  });
  t('marketCap 1000x-Skalenbug (nur eine Achse) -> MISMATCH', () => {
    assert.equal(evalTicker(30e9 * 1000, 20e9, 30e9, 20e9).status, 'mismatch');
  });
  // MARKTBEWEGUNG darf NICHT rot: marketCap +40% Kursbewegung zwischen Pull und Check.
  t('marketCap +40% Marktbewegung -> MATCH (kein Falsch-Rot)', () => {
    assert.equal(evalTicker(30e9 * 1.4, 20e9, 30e9, 20e9).status, 'match');
  });
  t('marketCap -50% / +100% bleibt unter Faktor 3.16 -> MATCH', () => {
    assert.equal(evalTicker(30e9 * 0.5, 20e9, 30e9, 20e9).status, 'match');
    assert.equal(evalTicker(30e9 * 2.0, 20e9, 30e9, 20e9).status, 'match');
  });
  // SKIP: fehlende/nicht-positive Werte (pre-revenue) -> nicht vergleichbar, nie Mismatch.
  t('null/0 Revenue -> skip (nicht Mismatch)', () => {
    assert.equal(evalTicker(30e9, null, 30e9, 20e9).status, 'skip');
    assert.equal(evalTicker(30e9, 0, 30e9, 20e9).status, 'skip');
    assert.equal(evalTicker(30e9, 20e9, 30e9, 0).status, 'skip');
  });
  // CLASSIFY: Rot-Schwelle + Transient-Entkopplung.
  t('classify: >=2 Mismatches -> rot', () => {
    const r = classify([
      { ticker: 'A', eval: { status: 'mismatch' } }, { ticker: 'B', eval: { status: 'mismatch' } },
      { ticker: 'C', eval: { status: 'match' } }, { ticker: 'D', eval: { status: 'match' } },
    ]);
    assert.equal(r.red, true); assert.equal(r.status, 'mismatch');
  });
  t('classify: 1 Mismatch -> NICHT rot (Ausreisser-Toleranz)', () => {
    const r = classify([
      { ticker: 'A', eval: { status: 'mismatch' } },
      { ticker: 'B', eval: { status: 'match' } }, { ticker: 'C', eval: { status: 'match' } }, { ticker: 'D', eval: { status: 'match' } },
    ]);
    assert.equal(r.red, false); assert.equal(r.status, 'ok');
  });
  t('classify: Yahoo global gedrosselt (>5/8 unreachable) -> inconclusive, NICHT rot', () => {
    const r = classify([
      { ticker: 'A', eval: { status: 'mismatch' } }, { ticker: 'B', eval: { status: 'mismatch' } },
      { ticker: 'C', unreachable: true }, { ticker: 'D', unreachable: true }, { ticker: 'E', unreachable: true },
      { ticker: 'F', unreachable: true }, { ticker: 'G', unreachable: true }, { ticker: 'H', unreachable: true },
    ]);
    assert.equal(r.red, false); assert.equal(r.status, 'inconclusive');
  });
  t('classify: <3 vergleichbar -> inconclusive', () => {
    const r = classify([{ ticker: 'A', eval: { status: 'mismatch' } }, { ticker: 'B', eval: { status: 'match' } }, { ticker: 'C', unreachable: true }]);
    assert.equal(r.status, 'inconclusive'); assert.equal(r.red, false);
  });
  t('seededPick deterministisch (gleicher Seed -> gleiche Auswahl)', () => {
    const arr = Array.from({ length: 50 }, (_, i) => 'T' + i);
    assert.deepEqual(seededPick(arr, 8, 202628), seededPick(arr, 8, 202628));
    assert.notDeepEqual(seededPick(arr, 8, 202628), seededPick(arr, 8, 202629));
  });
  try {
    const exits = [], errors = [];
    await runCli(async () => { throw new Error('Selftest-Absturz'); }, {
      exit: code => exits.push(code), error: line => errors.push(String(line)),
    });
    assert.deepEqual(exits, [1]);
    assert.match(errors.join('\n'), /::error::.*Selftest-Absturz/);
    pass++; console.log('  ok   CLI-Absturz -> ::error:: und Exit 1');
  } catch (e) { fail++; console.error('FAIL   CLI-Absturz -> ::error:: und Exit 1\n       ' + e.message); }

  console.log(`\nvalue-spot-check selftest: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

module.exports = { ratio, evalTicker, classify, isoWeekSeed, seededPick, run, runCli, TOL_LOG10 };
if (process.argv.includes('--selftest')) selftest().catch(e => { console.error(e); process.exit(1); });
else if (require.main === module) runCli();
