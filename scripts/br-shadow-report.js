#!/usr/bin/env node
'use strict';
/**
 * scripts/br-shadow-report.js — sd-quellen 07.11.2026. SHADOW comparison of the CVM store
 * (external-data/exchange-quarters/br.json) against the Yahoo quarters of the .SA snapshots.
 *
 *   node scripts/br-shadow-report.js --out <file.json> [--snapshots DIR] [--store FILE] [--tolerance 0.01]
 *
 * READS ONLY the snapshots and the store; WRITES --out. Changes no snapshot, score or export. Every snapshot goes
 * through prepareSnapshot first, so the Yahoo side is what scoring sees (hand tables, known Q4 cases).
 * Yahoo converts a statement with ONE rate per pull (meta.fxRateApplied, fx-rates.json); the CVM value
 * times that same rate is therefore currency-neutral against the Yahoo cell. Measured on WEGE3.SA
 * 2026-06-30: CVM 10,143,555 thousand BRL x 0.19428794 = 1,970.77 m USD, Yahoo 1,970.77 m USD.
 * A statement-currency hand-table row (meta.statementCurrencyOriginal, e.g. Petrobras, Embraer, Vale: the series are
 * the USD figures of their SEC filings) is unchecked: a BRL filing times one rate does not meet a USD series.
 *
 * Per ticker, field and quarter end one of:
 *   agree           |cvm/yahoo - 1| <= tolerance
 *   disagree        above the tolerance (a hint for a filing check, never an overwrite)
 *   cvm-only        CVM has the quarter, Yahoo's cell is empty or the end is missing inside Yahoo's span
 *   cvm-newer       CVM quarter newer than Yahoo's newest quarter
 *   yahoo-only      Yahoo has it, CVM not
 * Fields: revenueQ ~ 3.01, grossProfitQ ~ 3.03, opIncQ ~ 3.05 (EBIT before financial result; Yahoo's
 * operating income may exclude equity-method or other items, so disagreement there is expected and
 * measured, not judged), netIncomeQ ~ 3.11.01 (attributable to the parent's owners, as Yahoo shows it),
 * else 3.11 only on the individual statement (parent-only, so 3.11 is the owners' profit; a consolidated 3.11
 * includes minorities and is not compared, Codex R-pr115 F1).
 *   cvm-gap         CVM quarter not usable, with its reason (placeholder-zero, one-zero-leg); never another line
 * A ticker without any Yahoo quarter, or without a 3.01 line in any CVM document (scheme unknown), is unchecked.
 *   cvm-zero        CVM files 0 on the line (holding or insurer without a sales line), Yahoo shows a figure
 * Banks and insurers (S.BR_FINANCIAL on the 3.01 label) are unchecked: their DRE scheme puts other lines on the codes.
 */
const fs = require('fs');
const path = require('path');
const S = require('../lib/exchange-quarter-store.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');

const ROOT = path.join(__dirname, '..');
const FIELDS = [['revenueQ', 'rev'], ['grossProfitQ', 'gp'], ['opIncQ', 'ebit'], ['netIncomeQ', 'niParent', 'ni']];
const valueOf = (c) => (c && typeof c === 'object' ? c.value : c);

/** Compare one snapshot with its CVM company. Pure. @returns {object} */
function compareTicker(snap, store, tolerance) {
  const tk = snap.meta && snap.meta.ticker;
  const m = store.tickers && store.tickers[tk];
  if (!m) return { ticker: tk, unchecked: 'not in the CVM ticker map' };
  const company = store.companies[m.cnpj];
  if (!company) return { ticker: tk, unchecked: 'no CVM document for ' + m.cnpj };
  const meta = snap.meta;
  if (meta.statementCurrencyOriginal) return { ticker: tk, unchecked: 'statement series in ' + meta.statementCurrencyOriginal + ' (hand table)' };
  let fx = null;
  if (meta.reportingCurrency === 'BRL') fx = 1;
  else if (meta.reportingCurrencyOriginal === 'BRL' && meta.fxConverted && Number.isFinite(meta.fxRateApplied)) fx = meta.fxRateApplied;
  if (fx == null) return { ticker: tk, unchecked: 'Yahoo statement currency ' + (meta.reportingCurrencyOriginal || meta.reportingCurrency) + ' (CVM is BRL)' };
  const docs = Object.values(company.docs).map((l) => l[l.length - 1]);
  const fin = docs.find((o) => o.revenueLabel && S.BR_FINANCIAL.test(o.revenueLabel));
  if (fin) return { ticker: tk, unchecked: 'financial DRE scheme (' + fin.revenueLabel + ')' };
  if (!docs.some((o) => o.revenueLabel)) return { ticker: tk, unchecked: 'no 3.01 line in any CVM document (scheme unknown)' };
  const q = S.brSingleQuarters(company);
  const out = { ticker: tk, cnpj: m.cnpj, cls: m.cls, fx, cells: [] };
  const ts = snap.timeseries || {};
  // Codex R-pr115 F2: without any Yahoo quarter there is no span to compare in; say so instead of an empty row
  const spanOf = (field) => (ts[field + 'Ends'] || ts.revenueQEnds || []).filter((e, i) => e && Number.isFinite(valueOf((ts[field] || [])[i])));
  const tickerEnds = FIELDS.flatMap(([field]) => spanOf(field)).sort();
  if (!tickerEnds.length) return { ticker: tk, unchecked: 'no Yahoo quarter in any compared field' };
  // 3.11 stands in for 3.11.01 only on the individual statement, where it is the parent owners' profit (Codex F1)
  const cvmCell = (e, f, fallback) => {
    if (!q[e]) return null;
    if (q[e][f]) return q[e][f];
    return fallback && q[e][fallback] && q[e][fallback].basis === 'ind' ? q[e][fallback] : null;
  };
  for (const [field, f, fallback] of FIELDS) {
    const vals = ts[field] || [];
    const ends = ts[field + 'Ends'] || ts.revenueQEnds || [];
    const y = new Map();
    ends.forEach((e, i) => { const v = valueOf(vals[i]); if (e) y.set(e, Number.isFinite(v) ? v : null); });
    const ySorted = [...y.keys()].sort();
    const oldest = ySorted[0] || tickerEnds[0], newest = ySorted[ySorted.length - 1] || tickerEnds[tickerEnds.length - 1];
    const allEnds = new Set([...y.keys(), ...Object.keys(q).filter((e) => cvmCell(e, f, fallback) && e >= oldest)]);
    for (const e of [...allEnds].sort().reverse()) {
      const yv = y.has(e) ? y.get(e) : null;
      const c = cvmCell(e, f, fallback);
      const cv = c && c.value !== null ? c.value * fx : null;
      let cat;
      if (c && c.value === null) cat = 'cvm-gap';
      else if (c && yv != null) cat = cv === yv || Math.abs(cv / yv - 1) <= tolerance ? 'agree' : cv === 0 ? 'cvm-zero' : 'disagree';
      else if (c) cat = newest && e > newest ? 'cvm-newer' : 'cvm-only';
      else if (yv != null) cat = 'yahoo-only';
      else continue;
      out.cells.push({ field, end: e, cat, ...(c && c.gap ? { gap: c.gap } : {}), yahoo: yv, cvm: cv, cvmBrl: c ? c.value : null, received: c ? c.received : null,
        derived: c ? c.derived : null, basis: c ? c.basis : null, ratio: c && yv ? cv / yv : null });
    }
  }
  return out;
}

function summarise(rows) {
  const s = { tickers: rows.length, unchecked: {}, byField: {} };
  for (const r of rows) {
    if (r.unchecked) { s.unchecked[r.unchecked] = (s.unchecked[r.unchecked] || 0) + 1; continue; }
    for (const c of r.cells) {
      const k = c.field;
      const b = s.byField[k] || (s.byField[k] = {});
      b[c.cat] = (b[c.cat] || 0) + 1;
    }
  }
  return s;
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const dir = arg('snapshots', path.join(ROOT, 'snapshots'));
  const storeFile = arg('store', path.join(ROOT, 'external-data', 'exchange-quarters', 'br.json'));
  const out = arg('out', null);
  const tolerance = Number(arg('tolerance', '0.01'));
  if (!out) throw new Error('--out is required');
  const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  if (store.schemaVersion !== 1 || store.market !== 'BR') throw new Error(storeFile + ': not a BR store');
  const rows = fs.readdirSync(dir).filter((f) => /\.SA\.json$/.test(f)).sort()
    .map((f) => compareTicker(prepareSnapshot(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))), store, tolerance));
  const report = { generatedAt: new Date().toISOString(), tolerance, store: storeFile, snapshots: dir, summary: summarise(rows), rows };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report.summary, null, 1));
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('::error::br-shadow-report: ' + e.message); process.exit(1); }
}
module.exports = { compareTicker, summarise };
