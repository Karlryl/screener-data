#!/usr/bin/env node
'use strict';
/**
 * scripts/br-shadow-report.js — sd-quellen 07.11.2026. SHADOW comparison of the CVM store
 * (external-data/exchange-quarters/br.json) against the Yahoo quarters of the .SA snapshots.
 *
 *   node scripts/br-shadow-report.js --out <file.json> [--snapshots DIR] [--store FILE] [--tolerance 0.01]
 *
 * READS ONLY the snapshots and the store; WRITES --out. Changes no snapshot, score or export.
 * Yahoo converts a statement with ONE rate per pull (meta.fxRateApplied, fx-rates.json); the CVM value
 * times that same rate is therefore currency-neutral against the Yahoo cell. Measured on WEGE3.SA
 * 2026-06-30: CVM 10,143,555 thousand BRL x 0.19428794 = 1,970.77 m USD, Yahoo 1,970.77 m USD.
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
 * else 3.11 (consolidated; the only line of a company without minorities).
 *   cvm-zero        CVM files 0 on the line (holding or insurer without a sales line), Yahoo shows a figure
 * Banks and insurers (3.01 label "intermediação"/"segur..."/"prêmio") are reported as stratum financial.
 */
const fs = require('fs');
const path = require('path');
const S = require('../lib/exchange-quarter-store.js');

const ROOT = path.join(__dirname, '..');
const FIELDS = [['revenueQ', 'rev'], ['grossProfitQ', 'gp'], ['opIncQ', 'ebit'], ['netIncomeQ', 'niParent', 'ni']];
const FINANCIAL = /intermedia|segur|prêmio|previd/i;
const valueOf = (c) => (c && typeof c === 'object' ? c.value : c);

/** Compare one snapshot with its CVM company. Pure. @returns {object} */
function compareTicker(snap, store, tolerance) {
  const tk = snap.meta && snap.meta.ticker;
  const m = store.tickers && store.tickers[tk];
  if (!m) return { ticker: tk, unchecked: 'not in the CVM ticker map' };
  const company = store.companies[m.cnpj];
  if (!company) return { ticker: tk, unchecked: 'no CVM document for ' + m.cnpj };
  const meta = snap.meta;
  let fx = null;
  if (meta.reportingCurrency === 'BRL') fx = 1;
  else if (meta.reportingCurrencyOriginal === 'BRL' && meta.fxConverted && Number.isFinite(meta.fxRateApplied)) fx = meta.fxRateApplied;
  if (fx == null) return { ticker: tk, unchecked: 'Yahoo statement currency ' + (meta.reportingCurrencyOriginal || meta.reportingCurrency) + ' (CVM is BRL)' };
  const q = S.brSingleQuarters(company);
  const docs = Object.values(company.docs).map((l) => l[l.length - 1]);
  const label = (docs.find((o) => o.revenueLabel) || {}).revenueLabel || null;
  const out = { ticker: tk, cnpj: m.cnpj, cls: m.cls, stratum: label && FINANCIAL.test(label) ? 'financial' : 'general', fx, cells: [] };
  const ts = snap.timeseries || {};
  for (const [field, f, fallback] of FIELDS) {
    const vals = ts[field] || [];
    const ends = ts[field + 'Ends'] || ts.revenueQEnds || [];
    const y = new Map();
    ends.forEach((e, i) => { const v = valueOf(vals[i]); if (e) y.set(e, Number.isFinite(v) ? v : null); });
    const ySorted = [...y.keys()].sort();
    const oldest = ySorted[0], newest = ySorted[ySorted.length - 1];
    const allEnds = new Set([...y.keys(), ...Object.keys(q).filter((e) => (q[e][f] || (fallback && q[e][fallback])) && oldest && e >= oldest)]);
    for (const e of [...allEnds].sort().reverse()) {
      const yv = y.has(e) ? y.get(e) : null;
      const c = q[e] && (q[e][f] || (fallback && q[e][fallback]));
      const cv = c ? c.value * fx : null;
      let cat;
      if (c && yv != null) cat = cv === yv || Math.abs(cv / yv - 1) <= tolerance ? 'agree' : cv === 0 ? 'cvm-zero' : 'disagree';
      else if (c) cat = newest && e > newest ? 'cvm-newer' : 'cvm-only';
      else if (yv != null) cat = 'yahoo-only';
      else continue;
      out.cells.push({ field, end: e, cat, yahoo: yv, cvm: cv, cvmBrl: c ? c.value : null, received: c ? c.received : null,
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
      const k = r.stratum + ' ' + c.field;
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
    .map((f) => compareTicker(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), store, tolerance));
  const report = { generatedAt: new Date().toISOString(), tolerance, store: storeFile, snapshots: dir, summary: summarise(rows), rows };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report.summary, null, 1));
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('::error::br-shadow-report: ' + e.message); process.exit(1); }
}
module.exports = { compareTicker, summarise };
