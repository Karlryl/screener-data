'use strict';
// Guard: what a stale-price hold does next to the withheld market cap (Codex R17 on d89bc011d4, finding 2 and the ASML switch).
//
//   filter    - P/E, forward P/E, dividend yield and the distance to the 52-week high are Yahoo values on the same old quote
//               message: while the hold lasts none is shown, each with its own German hint naming the quote day. The distance
//               to the all-time high rests on the project's own daily closes: it stays while the newest close is at most
//               7 weekdays old and goes with its own hint otherwise. A row without a hold keeps every value. The filter
//               check refuses a price-dependent value beside a stale hold reason.
//   sibling   - a shown listing whose growth period is older than that of a sibling listing of the same issuer held by the
//               gate gets a hint naming both listings and both period ends; another issuer, an older held sibling and a
//               sibling that is not held give none.
// REAL guard, REAL filter builder and validator, REAL export helper on a temp store. Break-once on every start: the source is
// compiled in memory with one whole line replaced (nothing is written, live files are hashed before and after).
process.env.RUN_DATE_UTC = '2026-10-30';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const FILTER_FILE = path.join(ROOT, 'scripts/write-filter-universe.js');
const EXPORT_FILE = path.join(ROOT, 'scripts/write-findash-export.js');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hashes = [FILTER_FILE, EXPORT_FILE].map(f => [f, sha(f)]);
const G = require('../lib/market-cap-guard.js');
const F = require('../scripts/write-filter-universe.js');

function compiled(file, anchor, replacement) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(lines.map(l => (l === anchor ? replacement : l)).join('\n'), file);
  return m.exports;
}
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}

// Codex's row: quote message of 02.10., run day 30.10., Yahoo values P/E 20, forward P/E 12, yield 2 %, 52-week high 200.
const OLD = '2026-10-02T15:35:06.000Z', FRESH = '2026-10-30T08:00:00.000Z';
const priced = (stamp, ticker = 'OLD') => ({
  meta: { ticker, name: 'Old Company', sector: 'Technology', industry: 'Software', tradingCurrency: 'USD', reportingCurrency: 'USD',
    tradingCurrencyOriginal: 'USD', reportingCurrencyOriginal: 'USD', fxConverted: true, tradingFxRateApplied: 1, fxRateApplied: 1, asOf: FRESH },
  marketCap: { value: 1e12, asOf: FRESH, regularMarketTime: stamp },
  metrics: { pe: { value: 20 }, forwardPE: { value: 12 }, dividendYield: { value: 2 }, fiftyTwoWeekHigh: { value: 200 } },
  price: { regularMarketPrice: 100, currencyUnit: 'USD' }, annual: {}, timeseries: {},
});
const athFor = lastDate => ({ OLD: { ath: 200, athDate: '2025-01-02', lastClose: 100, lastDate } });
const build = (stamp, athLast = '2026-10-29', builder = F) => builder.buildUniverse({ snapshots: [G.prepareMarketCap(priced(stamp))],
  excluded: new Map([['OLD', ['market-cap-missing']]]), athEntries: athFor(athLast), generatedAt: FRESH });
const HINTS = ['P/E', 'Forward P/E', 'Dividendenrendite', 'Abstand zum 52-Wochen-Hoch']
  .map(l => `${l} wird nicht gezeigt, die Kursmeldung von Yahoo vom 02.10.2026 ist zu alt.`);

function heldRow(builder = F) {
  const row = build(OLD, '2026-10-29', builder).rows[0];
  for (const k of ['pe', 'fpe', 'dy', 'd52', 'mc']) assert.equal(row[k], undefined, k + ' shown beside the stale hold');
  assert.notEqual(row.peSt, 'vorhanden'); assert.equal(row.dySt, 'unbekannt');
  for (const h of HINTS) assert.ok(row.aus.includes(h), 'hint missing: ' + h);
  assert.equal(row.ath, -50, 'own daily close of 29.10. is current, the distance to the all-time high stays');
  return row;
}
check('filter: a stale hold empties P/E, forward P/E, dividend yield and the 52-week distance, each with its own hint', () => heldRow());

check('filter: the own-close distance to the all-time high goes once its newest close is older than 7 weekdays', () => {
  const row = build(OLD, '2026-10-20').rows[0];
  assert.equal(row.ath, undefined);
  assert.ok(row.aus.includes('Abstand zum Allzeithoch wird nicht gezeigt, weil der letzte eigene Tageskurs vom 20.10.2026 älter als 7 Wochentage ist.'));
});

// A 0 payout next to a paying vendor yield is the vendor's placeholder (T2); hiding the yield must not turn it into a shown 0.
const placeholder = (stamp, builder = F) => { const s = priced(stamp); s.metrics.payoutRatio = { value: 0 }; return builder.buildUniverse({ snapshots: [G.prepareMarketCap(s)], excluded: new Map([['OLD', ['market-cap-missing']]]), athEntries: athFor('2026-10-29'), generatedAt: FRESH }).rows[0]; };
check('filter: a placeholder payout of 0 stays missing when the yield is hidden', () => {
  assert.equal(placeholder(OLD).po, undefined, 'placeholder 0 payout shown beside the stale hold');
  assert.equal(placeholder(FRESH).po, undefined);
});
check('break-once: reading the hidden yield status would show the placeholder 0', () => {
  const line = "      ...div, po: poBad || (payout === 0 && (zahlt || dyBad)) ? null : round(payout), roe: round(metricVal(snapshot, 'returnOnEquity')),";
  const broken = compiled(FILTER_FILE, line, line.replace('(zahlt || dyBad)', "(div.dySt === 'zahlt' || dyBad)"));
  assert.equal(placeholder(OLD, broken).po, 0);
});

check('filter absence: without a hold every value stays, with no hint', () => {
  const row = build(FRESH).rows[0];
  assert.deepEqual([row.pe, row.peSt, row.fpe, row.dy, row.dySt, row.d52, row.ath, row.mc], [20, 'vorhanden', 12, 2, 'zahlt', -50, -50, 1e12]);
  assert.ok(!row.aus.some(a => a.includes('wird nicht gezeigt')));
});

check('filter check: green on the built feed; a value put back beside the stale reason is refused', () => {
  const feed = build(OLD);
  const bytes = Buffer.byteLength(JSON.stringify(feed));
  assert.deepEqual(F.validateUniverse(feed, bytes).filter(e => e.includes('stale quote')), []);
  for (const [k, v] of [['pe', 20], ['fpe', 12], ['dy', 2], ['d52', -50]]) {
    const bad = structuredClone(feed); bad.rows[0][k] = v; if (k === 'pe') bad.rows[0].peSt = 'vorhanden'; if (k === 'dy') bad.rows[0].dySt = 'zahlt';
    assert.ok(F.validateUniverse(bad, bytes).some(e => e.includes('price-dependent value beside a stale quote hold')), k);
  }
});

check('break-once: without the hold test in the filter the values come back and the check above fails', () => {
  const broken = compiled(FILTER_FILE, '    const kursAlt = snapshot.marketCap?.source === STALE_PRICE_SOURCE;', '    const kursAlt = false;');
  assert.throws(() => heldRow(broken), /shown beside the stale hold/);
});

// Sibling hint: two lines of one issuer in a temp main store, the Milan line held with the newer quarter.
const listing = (ticker, stamp, ends, name = 'ASML Holding N.V.') => ({
  meta: { ticker, name, tradingCurrency: 'USD', reportingCurrency: 'USD', tradingCurrencyOriginal: 'USD', reportingCurrencyOriginal: 'USD',
    fxConverted: true, tradingFxRateApplied: 1, fxRateApplied: 1, asOf: FRESH },
  marketCap: { value: 7e11, asOf: FRESH, regularMarketTime: stamp }, price: { regularMarketPrice: 100 }, metrics: {}, annual: {},
  timeseries: { revenueQ: ends.map((e, i) => ({ value: i === 0 ? 120 : 100 })), revenueQEnds: ends },
});
const Q3 = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'];
const Q2 = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
function exportWithStore(rows, anchor, replacement) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'held-sibling-'));
  for (const r of rows) fs.writeFileSync(path.join(dir, r.meta.ticker + '.json'), JSON.stringify(r));
  const prior = process.env.FINDASH_SNAPSHOTS_DIR;
  process.env.FINDASH_SNAPSHOTS_DIR = dir;
  try { return compiled(EXPORT_FILE, anchor ?? 'let _heldByIssuer = null;', replacement ?? 'let _heldByIssuer = null;'); }
  finally { if (prior === undefined) delete process.env.FINDASH_SNAPSHOTS_DIR; else process.env.FINDASH_SNAPSHOTS_DIR = prior; }
}
const SHOWN = listing('ASML.WA', FRESH, Q2).meta;
function sibling(writer) {
  const hit = writer.heldNewerSibling(SHOWN, 'ASML.WA', '2026-06-30');
  assert.deepEqual(hit && [hit.ticker, hit.periodEnd], ['1ASML.MI', '2026-09-30'], 'held sibling with the newer quarter');
  assert.equal(writer.heldNewerSibling(SHOWN, 'ASML.WA', '2026-09-30'), null, 'shown period as new as the held one');
}
check('sibling: a held listing of the same issuer with a newer quarter is found, with both period ends', () => {
  sibling(exportWithStore([listing('1ASML.MI', OLD, Q3), listing('ASML.WA', FRESH, Q2), listing('OTHER.MI', OLD, Q3, 'Other Firm SpA')]));
});
check('sibling absence: a sibling that is not held, or another issuer, gives no hint', () => {
  const w = exportWithStore([listing('1ASML.MI', FRESH, Q3), listing('ASML.WA', FRESH, Q2), listing('OTHER.MI', OLD, Q3, 'Other Firm SpA')]);
  assert.equal(w.heldNewerSibling(SHOWN, 'ASML.WA', '2026-06-30'), null);
});
check('break-once: without the period comparison an older sibling would be named and the absence above fails', () => {
  const lines = fs.readFileSync(EXPORT_FILE, 'utf8').split(/\r?\n/);
  const anchor = lines.find(l => l.startsWith('  return (key && _heldByIssuer.get(key) || []).filter(h => h.ticker !== ticker && h.periodEnd > shownEnd && same(h))'));
  assert.ok(anchor, 'filter line');
  const w = exportWithStore([listing('1ASML.MI', OLD, Q3), listing('ASML.WA', FRESH, Q2)], anchor, anchor.replace(' && h.periodEnd > shownEnd', ''));
  assert.throws(() => sibling(w), /as new as the held one/);
});

for (const [f, h] of hashes) assert.equal(sha(f), h, 'live source changed: ' + f);
console.log(`stale-price-filter-and-sibling: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
