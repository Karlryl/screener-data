'use strict';
// S11 monthly quality meter, step 1 (read-only): draws 100 visible values from 50 firms of a published gh-pages export.
// Same draw as the baseline measurement of 22.11.2026 (C:\Users\Anwender\.codex\reports\s11-qualitaetsmesser-2026-11-22\,
// script ziehen.js there): 17 HyperGrowth firms from the visible top 20 of every list, 17 Rule of 40 firms from the top 100,
// 16 filter firms from all rows, two filled fields each, a firm at most once (counting level: ticker), mulberry32 seed.
// The pre-registration of each month (seed, tolerances, rounds) is written and hashed before this runs.
//
// Usage: node scripts/qualitaetsmesser-ziehen.js --pages <gh-pages root> --seed <YYYYMMDD> --out <folder> [--datentag YYYY-MM-DD]
//   <gh-pages root>: a checkout or extraction of the gh-pages commit being measured (outputs/hypergrowth, outputs/findash-export/v1).
//   Writes only <folder>/sample.json. Exit 0 written, 1 input missing or too small, 2 bad arguments.
const fs = require('fs');
const path = require('path');

/**
 * mulberry32, the generator of the baseline draw.
 * @param {number} seed Start value.
 * @returns {() => number} Uniform numbers in [0, 1).
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const filled = v => v !== undefined && v !== null && !(typeof v === 'number' && !Number.isFinite(v));
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const EXCLUDED_FILES = /index|overview|survival|excluded/;
const QUOTAS = { hyperGrowth: 34, rule40: 68, filter: 100 }; // cumulative value counts, two per firm
const FILTER_FIELDS = ['g', 'g3', 'gm', 'fcf', 'roe', 'pe', 'mc', 'dy'];

/**
 * Read the four inputs of the draw from a gh-pages root.
 * @param {string} root gh-pages checkout root.
 * @returns {{hg: {name: string, json: object}[], full: object[], rule40: object[], filter: object[], generatedAt: string|null}}
 */
function readPages(root) {
  const v1 = path.join(root, 'outputs', 'findash-export', 'v1');
  const hgDir = path.join(root, 'outputs', 'hypergrowth');
  const json = dir => fs.readdirSync(dir).filter(f => f.endsWith('.json') && !EXCLUDED_FILES.test(f)).sort();
  return {
    hg: json(hgDir).map(f => ({ name: f.slice(0, -5), json: read(path.join(hgDir, f)) })),
    full: json(v1).map(f => read(path.join(v1, f))),
    rule40: read(path.join(v1, 'rule40', 'overview.json')).rows,
    filter: read(path.join(v1, 'filter', 'universum.json')).rows,
    generatedAt: read(path.join(v1, 'index.json')).generated_at ?? null,
  };
}

/**
 * Draw the sample. The order of random calls is the baseline's; changing it changes every later month's draw.
 * @param {ReturnType<typeof readPages>} input Export contents.
 * @param {number} seed Start value of the month (pre-registered).
 * @param {string} datentag Data day of the export, named in the market-cap period.
 * @returns {object[]} 100 entries {id, stratum, ticker, name, country, field, shown, period, extra}.
 */
function draw(input, seed, datentag) {
  const R = rng(seed);
  const pick = arr => arr[Math.floor(R() * arr.length)];
  const sampleK = (arr, k) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
  // Full export rows by ticker (period labels for HyperGrowth); the first board file that carries a ticker wins.
  const full = new Map();
  const walk = v => {
    if (Array.isArray(v)) { for (const x of v) { if (x && x.ticker) { if (!full.has(x.ticker)) full.set(x.ticker, x); } else walk(x); } }
    else if (v && typeof v === 'object') for (const k in v) walk(v[k]);
  };
  input.full.forEach(walk);
  const used = new Set(), out = [];
  let id = 0;
  const add = (stratum, row, field, shown, period, extra = {}) => out.push({ id: ++id, stratum, ticker: row.ticker, name: row.name, country: row.country, field, shown, period, extra });
  // A frame without enough firms with two filled fields would loop forever; it is refused instead.
  const guard = (tickers, label, need) => {
    const n = new Set(tickers).size;
    if (n < need) throw new Error(`${label}: only ${n} candidate firms, ${need} needed`);
  };

  const hgFrame = [];
  for (const { name, json } of input.hg) {
    for (const track of ['profitable', 'unprofitable']) (Array.isArray(json[track]) ? json[track] : []).slice(0, 20).forEach(r => hgFrame.push({ r, list: name + '/' + track }));
  }
  const hgFields = r => {
    const fr = full.get(r.ticker) || {};
    const c = [];
    if (filled(r.revGrowthYoYPct)) c.push(['revGrowthYoYPct', r.revGrowthYoYPct, { basis: fr.revGrowthBasis, periodEnd: fr.revGrowthPeriodEnd, prior: fr.revGrowthPriorPeriodEnd }, {}]);
    if (r.overview && r.overview.kind === 'gp' && filled(r.overview.value)) c.push(['kennzahl_gp', r.overview.value, r.overview.period, { note: 'gross-profit growth YoY as fraction (0.889 = 88.9 %)' }]);
    if (filled(r.marketCap)) c.push(['marketCapUSD', r.marketCap, { asOf: `export ${datentag} (price of prior trading day)` }, {}]);
    return c;
  };
  guard(hgFrame.filter(x => hgFields(x.r).length >= 2).map(x => x.r.ticker), 'HyperGrowth', QUOTAS.hyperGrowth / 2);
  while (out.length < QUOTAS.hyperGrowth) {
    const { r, list } = pick(hgFrame);
    if (used.has(r.ticker)) continue;
    const c = hgFields(r); if (c.length < 2) continue;
    used.add(r.ticker);
    for (const [f, v, p, x] of sampleK(c, 2)) add('HyperGrowth/' + list, r, f, v, p, x);
  }

  const r40 = input.rule40.filter(r => r.rank <= 100);
  const r40Fields = r => {
    const c = [];
    if (filled(r.revGrowthYoYPct)) c.push(['revGrowthYoYPct', r.revGrowthYoYPct, { basis: r.revGrowthBasis, periodEnd: r.revGrowthPeriodEnd, prior: r.revGrowthPriorPeriodEnd }, {}]);
    if (filled(r.fcfMarginPct)) c.push(['fcfMarginPct_TTM', r.fcfMarginPct, { periodEnd: r.fcfMarginPeriodEnd, source: r.fcfMarginSource }, {}]);
    if (filled(r.ebitdaMarginPct)) c.push(['ebitdaMarginPct_TTM', r.ebitdaMarginPct, {}, {}]);
    return c;
  };
  guard(r40.filter(r => !used.has(r.ticker) && r40Fields(r).length >= 2).map(r => r.ticker), 'Rule of 40', (QUOTAS.rule40 - QUOTAS.hyperGrowth) / 2);
  while (out.length < QUOTAS.rule40) {
    const r = pick(r40);
    if (used.has(r.ticker)) continue;
    const c = r40Fields(r);
    if (c.length < 2) continue;
    used.add(r.ticker);
    for (const [f, v, p, x] of sampleK(c, 2)) add('Rule40/rank' + r.rank, r, f, v, p, x);
  }

  const uni = input.filter;
  guard(uni.filter(r => !used.has(r.t) && FILTER_FIELDS.filter(k => filled(r[k])).length >= 2).map(r => r.t), 'Filter', (QUOTAS.filter - QUOTAS.rule40) / 2);
  while (out.length < QUOTAS.filter) {
    const r = pick(uni);
    if (used.has(r.t)) continue;
    const c = FILTER_FIELDS.filter(k => filled(r[k]));
    if (c.length < 2) continue;
    used.add(r.t);
    const row = { ticker: r.t, name: r.n, country: r.c };
    for (const k of sampleK(c, 2)) add('Filter', row, 'filter_' + k, r[k], { asOf: r.asOf, fp: r.fp, fq: r.fq }, { sector: r.s, aus: r.aus });
  }
  return out;
}

function main(argv) {
  const arg = name => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };
  const root = arg('pages'), out = arg('out'), seed = Number(arg('seed'));
  if (!root || !out || !Number.isInteger(seed)) { console.error('usage: --pages <gh-pages root> --seed <YYYYMMDD> --out <folder> [--datentag YYYY-MM-DD]'); return 2; }
  let input;
  try { input = readPages(root); } catch (e) { console.error('input missing: ' + e.message); return 1; }
  const datentag = arg('datentag') || (input.generatedAt ? input.generatedAt.slice(0, 10) : null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datentag || '')) { console.error('no data day: pass --datentag, index.json has no generated_at'); return 2; }
  let sample;
  try { sample = draw(input, seed, datentag); } catch (e) { console.error(e.message); return 1; }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'sample.json'), JSON.stringify(sample, null, 1));
  const firms = new Set(sample.map(x => x.ticker)).size;
  console.log('values', sample.length, 'firms', firms, 'us', sample.filter(x => x.country === 'United States').length, 'cn', sample.filter(x => x.country === 'China').length);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { rng, readPages, draw, main };
