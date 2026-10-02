#!/usr/bin/env node
'use strict';
/**
 * scripts/exchange-check-report.js — Tag 1403 (G2b) SHADOW report of the exchange cross-check.
 *
 *   node scripts/exchange-check-report.js --out <file.json> [--snapshots DIR] [--outputs DIR]
 *        [--store DIR] [--board-history DIR] [--active-outputs DIR] [--must-withhold T1,T2,...]
 *
 * READS ONLY: snapshots (default snapshots/), the scoring outputs of the same run (default outputs/:
 * hypergrowth/<branch>.json top lists, hypergrowth/full/<branch>.json, hypergrowth/overview.json,
 * findash-export/v1/rule40/overview.json), the committed exchange store and board-history (baseline of
 * the fill). WRITES only --out. Changes no snapshot, score, export or vintage: the step runs here in mode
 * shadow (lib/exchange-quarter-check.js), the readers stay on the committed mode (off).
 *
 * Per board row of the China and Taiwan cohorts one of agree | would-withhold | would-withhold-growth |
 * would-fill | unchecked(<why>), with vendor and exchange values, pairs, stratum, boards and ranks, and for
 * every would-* row the reader effects of the active step on that row (growth leg and value, acceleration,
 * lamps). --active-outputs: outputs of a sandbox run with mode active on the same snapshots; adds score and
 * rank after. Census: every would-withhold board row is listed (go criterion of G2c: 0 false holds after
 * each listed row is checked against the filing).
 */
const fs = require('fs');
const path = require('path');
const X = require('../lib/exchange-quarter-check.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { revAcceleration } = require('../src/scoring/axes.js');
const { evaluateLamps } = require('../src/scoring/lamps.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const ROOT = path.join(__dirname, '..');
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const round = x => Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x;

/** Board rows and full-cohort ranks from one scoring output directory. */
function boardsOf(dir) {
  const rows = new Map(), full = new Map();
  const add = (t, e) => { if (!rows.has(t)) rows.set(t, []); rows.get(t).push(e); };
  const idx = readJson(path.join(dir, 'hypergrowth', 'index.json'));
  for (const b of idx?.branches || []) {
    const top = readJson(path.join(dir, 'hypergrowth', b + '.json')) || {};
    const all = readJson(path.join(dir, 'hypergrowth', 'full', b + '.json')) || {};
    for (const track of ['profitable', 'unprofitable']) {
      (top[track] || []).forEach((r, i) => add(r.ticker, { board: b, track, rank: i + 1 }));
      (all[track] || []).forEach((r, i) => full.set(r.ticker, { board: b, track, rank: i + 1, score: r.score, growth: r.revGrowthYoYPct ?? null }));
    }
  }
  (readJson(path.join(dir, 'hypergrowth', 'overview.json')) || []).forEach((r, i) => add(r.ticker, { board: 'overview', rank: i + 1 }));
  for (const r of readJson(path.join(dir, 'findash-export', 'v1', 'rule40', 'overview.json'))?.rows || []) {
    if (r.rank != null) add(r.ticker, { board: 'rule40', rank: r.rank });
  }
  return { rows, full };
}

const lampsOf = s => { try { return evaluateLamps(s).active.sort(); } catch (e) { return ['error:' + e.message]; } };
function effects(before, after) {
  const lb = revGrowthLeg(before), la = revGrowthLeg(after);
  const out = {
    growth: { before: { basis: lb.basis, pct: round(lb.pct), periodEnd: lb.periodEnd, priorPeriodEnd: lb.priorPeriodEnd },
      after: { basis: la.basis, pct: round(la.pct), periodEnd: la.periodEnd, priorPeriodEnd: la.priorPeriodEnd } },
    acceleration: { before: round(revAcceleration(before)), after: round(revAcceleration(after)) },
  };
  const a = lampsOf(before), b = lampsOf(after);
  out.lamps = { before: a, after: b, on: b.filter(x => !a.includes(x)), off: a.filter(x => !b.includes(x)) };
  return out;
}

function compactResult(r) {
  return { category: r.category, why: r.why, stratum: r.stratum, line: r.line,
    pairs: r.pairs.map(p => ({ end: p.end, priorEnd: p.priorEnd, level: p.level, status: p.status,
      vendor: p.vendor.map(round), exchange: p.exchange.map(round), ratio: p.ratio && p.ratio.map(round) })),
    withhold: r.withhold.map(w => ({ period: w.period, level: w.level, vendorNative: round(w.vendorNative), exchangeNative: round(w.exchangeNative) })),
    growth: r.growth, fill: r.fill && { period: r.fill.period, blocked: r.fill.blocked, otherwiseFillable: r.fill.otherwiseFillable || false,
      nativeValue: round(r.fill.nativeValue), source: r.fill.source, dataDate: r.fill.dataDate },
    outsideDisagree: r.outsideDisagree, fillPeriodVendorDisagrees: r.fillPeriodVendorDisagrees };
}

// Board rows whose quarterly growth leg is blocked only by an empty vendor cell at a fill period (the gap rule).
function gapBlocked(s) {
  const ends = s?.timeseries?.revenueQEnds || [], rows = s?.timeseries?.revenueQ || [];
  return X.policy.fillPeriods.some(P => {
    const k = ends.indexOf(P), v = rows[k];
    return k > 0 && (v == null || (typeof v === 'object' && v.value == null)) && revGrowthLeg(s).basis !== 'quarter';
  });
}

function main() {
  const out = arg('out');
  if (!out) { console.error('usage: node scripts/exchange-check-report.js --out <file.json> [...]'); process.exit(2); }
  const snapDir = path.resolve(arg('snapshots', path.join(ROOT, 'snapshots')));
  const outputs = path.resolve(arg('outputs', path.join(ROOT, 'outputs')));
  const activeOutputs = arg('active-outputs') ? path.resolve(arg('active-outputs')) : null;
  const must = (arg('must-withhold', '') || '').split(',').filter(Boolean);
  const stores = X.loadStores(path.resolve(arg('store', path.join(ROOT, 'external-data', 'exchange-quarters'))));
  const baseline = X.loadBaseline(path.resolve(arg('board-history', path.join(ROOT, 'board-history'))));
  const ctx = { stores, baseline };
  const B = boardsOf(outputs), A = activeOutputs ? boardsOf(activeOutputs) : null;
  const report = { schema: 'exchange-check-shadow/v1', generatedAt: new Date().toISOString(), mode: 'shadow',
    committedMode: X.policy.mode, tolerance: X.policy.tolerance, fillPeriods: X.policy.fillPeriods,
    inputs: { snapshots: snapDir, outputs, activeOutputs, storeFetchedAt: Object.fromEntries(['cn', 'tw'].map(k =>
      [k, stores[k] ? Object.values(stores[k].sources).map(s => s.fetchedAt).sort().at(-1) : null])), baselineDate: baseline.date },
    warnings: [...stores.warnings, ...baseline.warnings], counts: {}, boardRows: [], mustWithhold: null, gapBlockedBoardRows: null, twins: null };
  const cnt = (bucket, key) => { report.counts[bucket] = report.counts[bucket] || {}; report.counts[bucket][key] = (report.counts[bucket][key] || 0) + 1; };
  const checked = [], hk = [], results = new Map();
  let gapAll = 0, gapCnTw = 0, gapFill = 0;
  const log = console.warn; console.warn = () => {};
  try {
    for (const f of fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort()) {
      const raw = readJson(path.join(snapDir, f));
      const t = raw?.meta?.ticker;
      if (!t) continue;
      const onBoard = B.rows.has(t);
      const isCnTw = /\.(SS|SZ|TW|TWO)$/.test(t);
      if (!isCnTw && !(onBoard && /\.HK$/.test(t))) { if (onBoard && gapBlocked(prepareSnapshot(raw))) gapAll++; continue; }
      const s = prepareSnapshot(raw);
      if (/\.HK$/.test(t)) { hk.push(s); if (gapBlocked(s)) gapAll++; continue; }
      const r = X.applyExchangeCheck(s, { mode: 'shadow', context: ctx }).result;
      results.set(t, r);
      const key = r.category + (r.why ? '(' + r.why + ')' : '');
      cnt('all', key); cnt('all:' + r.market, key); cnt('all:' + (r.stratum || 'none'), key);
      if (r.category !== 'unchecked') checked.push({ t, s, r });
      if (onBoard) {
        cnt('board', key); cnt('board:' + r.market, key); cnt('board:' + (r.stratum || 'none'), key);
        if (r.fill?.blocked) cnt('board:fillBlocked', r.fill.blocked + (r.fill.otherwiseFillable ? '(otherwise fillable)' : ''));
        if (r.growth) cnt('board:levelWithheldAnnual', r.growth.basisAfter + '/' + r.growth.status);
        if (gapBlocked(s)) { gapAll++; gapCnTw++; if (r.category === 'would-fill') gapFill++; }
        const row = { ticker: t, market: r.market, boards: B.rows.get(t), fullRank: B.full.get(t) || null, ...compactResult(r) };
        if (r.category.startsWith('would-')) {
          const after = X.applyResult(s, r);
          row.effects = effects(s, after);
          if (A) row.effects.scoreRank = { before: B.full.get(t) || null, after: A.full.get(t) || null, boardsAfter: A.rows.get(t) || [] };
        }
        report.boardRows.push(row);
      }
    }
  } finally { console.warn = log; }
  report.gapBlockedBoardRows = { all: gapAll, chinaTaiwan: gapCnTw, wouldFill: gapFill };
  // H-share twins of a checked A-share: every overlapping quarter equal in CNY (to the yuan). Not guarded here.
  const native = s => { const m = s.meta || {}, f = m.fxConverted ? m.fxRateApplied : 1;
    return (s.timeseries?.revenueQ || []).map(x => { const v = typeof x === 'number' ? x : x?.value; return Number.isFinite(v) && f > 0 ? v / f : null; }); };
  const byFirst = new Map();
  for (const c of checked) { const n = native(c.s), e = c.s.timeseries.revenueQEnds;
    const k = e?.[0] + '|' + Math.round(n[0]); if (!byFirst.has(k)) byFirst.set(k, []); byFirst.get(k).push(c); }
  report.twins = [];
  for (const h of hk) {
    const m = h.meta || {};
    if ((m.reportingCurrencyOriginal || m.reportingCurrency) !== 'CNY' || !B.rows.has(m.ticker)) continue;
    const n = native(h), e = h.timeseries?.revenueQEnds || [];
    for (const c of byFirst.get(e[0] + '|' + Math.round(n[0])) || []) {
      const cn = native(c.s), ce = c.s.timeseries.revenueQEnds;
      const overlap = e.map((d, i) => [i, ce.indexOf(d)]).filter(([i, j]) => j >= 0 && n[i] !== null && cn[j] !== null);
      if (overlap.length >= 2 && overlap.every(([i, j]) => Math.abs(n[i] - cn[j]) <= 1)) {
        report.twins.push({ ticker: m.ticker, twinOf: c.t, twinCategory: c.r.category, boards: B.rows.get(m.ticker), overlappingQuarters: overlap.length });
      }
    }
  }
  if (must.length) {
    report.mustWithhold = must.map(t => {
      const r = results.get(t);
      return { ticker: t, category: r ? r.category : 'absent', why: r?.why || null, stratum: r?.stratum || null,
        pass: !!r && (r.category === 'would-withhold' || r.category === 'would-withhold-growth'), onBoard: B.rows.has(t), boards: B.rows.get(t) || [] };
    });
    report.mustWithholdPass = report.mustWithhold.filter(x => x.pass).length + '/' + must.length;
  }
  report.counts.boardRowsChinaTaiwan = report.boardRows.length;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(`[exchange-check-shadow] ${JSON.stringify({ board: report.counts.board, gapBlocked: report.gapBlockedBoardRows,
    mustWithhold: report.mustWithholdPass || null, twins: report.twins.length, warnings: report.warnings.length })}`);
}

if (require.main === module) main();
module.exports = { boardsOf, gapBlocked };
