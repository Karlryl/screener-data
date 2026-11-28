'use strict';
// S11 Stufe 4 (22.11.2026): fail-closed withholds of demonstrably wrong values, one class each.
//
//   frozen  - an OTC line whose newest 20 stored closes are identical and equal its quote price (TOKSF): the filter feed
//             withholds market cap and every price ratio with one German reason naming exactly those fields; the check
//             refuses a named field beside it; the writer refuses to run without a price store.
//   growth  - a China A-share whose shown growth misses the exchange revenues of the same two periods by more than 2 pp and
//             5 % (601688.SS): shownGrowthCheck says 'mixed' on every filing-checked wrong row of the cut fixture of
//             02.10.2026 that has no hand table, and 'agree' on every other one; the writer withholds g and r40.
//   ebitda  - Yahoo's EBITDA margin more than 2 points under the operating margin of the same four quarters (LPG): the Rule
//             of 40 board shows no EBITDA margin and no r40Ebitda, with ebitdaMarginReason; its check refuses a number beside it.
// REAL writers, REAL check functions, temp stores. Break once: sources compiled in memory with one whole line replaced
// (nothing is written; the live files are hashed before and after).
process.env.RUN_DATE_UTC = '2026-11-21';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'withhold-wrong-'));
// The growth fixture's exchange store, through the loader's own seam (before the first defaultContext()).
const EQ = require('./fixtures/exchange-quarter-check.json');
const storeDir = path.join(tmp, 'exchange-quarters');
fs.mkdirSync(storeDir);
for (const key of ['cn', 'tw']) fs.writeFileSync(path.join(storeDir, key + '.json'), JSON.stringify(EQ.store[key]));
process.env.EXCHANGE_QUARTERS_DIR = storeDir;

const FILES = ['scripts/write-filter-universe.js', 'scripts/write-rule40-export.js', 'lib/frozen-close.js', 'lib/shown-growth-check.js']
  .map(f => path.join(ROOT, f));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hashes = FILES.map(f => [f, sha(f)]);
const FC = require('../lib/frozen-close.js');
const store = require('../lib/price-history-store.js');
const X = require('../lib/shown-growth-check.js');
const W = require('../scripts/write-filter-universe.js');
const R = require('../scripts/write-rule40-export.js');
const { snapshot, boardZeile, baueExport } = require('./rule40-fixture.js');

function compiled(file, anchor, replacement) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor: ' + anchor);
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(lines.map(l => (l === anchor ? replacement : l)).join('\n'), file);
  return m.exports;
}
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e.stack || e.message)); }
}

// ── frozen ──────────────────────────────────────────────────────────────────
const FRESH = '2026-11-21T10:25:23.447Z';
const days = (n, close, from = '2026-09-29') => {
  const out = [];
  for (let t = Date.parse(from); out.length < n; t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), close });
  }
  return out;
};
const TOKSF_CLOSE = 9.105999946594238; // the store keeps float32 noise, the quote says 9.106
const otcSnapshot = (ticker, price = 9.106, exchangeName = 'OTC Markets OTCPK') => ({
  meta: { ticker, name: 'Tokyo Steel Manufacturing Co., Ltd.', sector: 'Basic Materials', industry: 'Steel', exchangeName,
    tradingCurrency: 'USD', reportingCurrency: 'USD', tradingCurrencyOriginal: 'USD', reportingCurrencyOriginal: 'USD',
    fxConverted: true, tradingFxRateApplied: 1, fxRateApplied: 1, asOf: FRESH },
  marketCap: { value: 920092096, asOf: FRESH, regularMarketTime: '2026-11-19T21:00:00.000Z' },
  metrics: { priceSales: { value: 0.51 }, enterpriseToRevenue: { value: 0.4 }, revenueTTM: { value: 1.8e9 }, pe: { value: 9 },
    forwardPE: { value: 8 }, dividendYield: { value: 2.77 }, fiftyTwoWeekHigh: { value: 10.96 }, returnOnEquity: { value: 4.36 } },
  price: { regularMarketPrice: price, currencyUnit: 'USD' }, annual: {}, timeseries: {},
});
const NAMED = ['mc', 'ps', 'evs', 'pe', 'fpe', 'dy', 'd52'];
const frozenFeed = (builder, runs, snaps = [otcSnapshot('TOKSF')]) => builder.buildUniverse({ snapshots: snaps,
  excluded: new Map(snaps.map(s => [s.meta.ticker, ['non-us']])), frozenCloses: runs, generatedAt: FRESH });

check('frozen: a run needs 20 identical closes that equal the quote price (float32 noise allowed)', () => {
  assert.deepEqual(FC.frozenRun(days(39, TOKSF_CLOSE), 9.106), { since: '2026-09-29', days: 39 });
  assert.equal(FC.frozenRun(days(19, TOKSF_CLOSE), 9.106), null, '19 days are not enough');
  assert.deepEqual(FC.frozenRun([...days(5, 8.5, '2026-08-03'), ...days(20, TOKSF_CLOSE)], 9.106), { since: '2026-09-29', days: 20 });
  assert.equal(FC.frozenRun(days(39, TOKSF_CLOSE), 9.2), null, 'a quote that moved since the store says the line trades');
  const moving = days(39, TOKSF_CLOSE); moving[30] = { ...moving[30], close: 9.2 };
  assert.equal(FC.frozenRun(moving, 9.106), null, 'a change inside the last 20 days breaks the run');
  assert.equal(FC.frozenRun(undefined, 9.106), null);
  assert.equal(FC.frozenRun(days(39, TOKSF_CLOSE), null), null);
});

check('frozen: loadFrozenRuns reads every OTC line, with or without a market cap, and refuses a missing store', () => {
  const dir = path.join(tmp, 'prices');
  store.saveAll(dir, { TOKSF: days(39, TOKSF_CLOSE), NOCAP: days(39, TOKSF_CLOSE), '5423.T': days(39, 1705),
    MOVE: days(39, 3).map((r, i) => ({ ...r, close: 3 + i })) });
  const noCap = otcSnapshot('NOCAP'); noCap.marketCap = { value: null };
  const runs = FC.loadFrozenRuns(dir, [otcSnapshot('TOKSF'), { ...otcSnapshot('5423.T', 1705, 'Tokyo') }, otcSnapshot('MOVE', 41), noCap]);
  assert.deepEqual([...runs.keys()].sort(), ['NOCAP', 'TOKSF'], 'the home listing in Tokyo and a moving OTC line are no case');
  assert.throws(() => FC.loadFrozenRuns(path.join(tmp, 'no-store'), []), /Price store missing/);
});

check('frozen: break once, a partial store (metadata stamped, wanted shard missing) throws instead of judging nothing', () => {
  const dir = path.join(tmp, 'prices-partial');
  store.saveAll(dir, { TOKSF: days(39, TOKSF_CLOSE), SPY: days(39, 500).map((r, i) => ({ ...r, close: 500 + i })) });
  assert.deepEqual([...FC.loadFrozenRuns(dir, [otcSnapshot('TOKSF')]).keys()], ['TOKSF'], 'complete store');
  fs.unlinkSync(store.shardPath(dir, store.shardOf('TOKSF')));
  assert.throws(() => FC.loadFrozenRuns(dir, [otcSnapshot('TOKSF')]), /Price store partial: history-\d\d\.json missing/);
  assert.throws(() => store.loadAll(dir), /partial store/, 'same behaviour as store.loadAll');
  const blind = compiled(FILES[2], '    if (!fs.existsSync(store.shardPath(pricesDir, shard))) {', '    if (false) {');
  assert.equal(blind.loadFrozenRuns(dir, [otcSnapshot('TOKSF')]).size, 0, 'broken: the partial store fails open silently');
});

check('frozen: the filter feed withholds every price value with one reason naming exactly them', () => {
  const feed = frozenFeed(W, new Map([['TOKSF', { since: '2026-09-29', days: 39 }]]));
  const [row] = feed.rows;
  for (const k of NAMED) assert.equal(row[k], undefined, k);
  assert.equal(row.roe, 4.36, 'ROE does not rest on the price');
  assert.equal(row.peSt, 'unbekannt'); assert.equal(row.dySt, 'unbekannt');
  const reason = row.aus.find(a => a.endsWith(FC.FROZEN_CLOSE_RETURN));
  assert.equal(reason, 'Börsenwert, P/S, EV/Sales, P/E, Forward P/E, Dividendenrendite und Abstand zum 52-Wochen-Hoch werden nicht gezeigt, '
    + 'weil der Schlusskurs dieser OTC-Notierung mindestens seit dem 29.09.2026 unverändert ist (39 Handelstage). '
    + 'Ein so lange unveränderter Kurs ist kein aktueller Marktpreis. Die Werte kommen ' + FC.FROZEN_CLOSE_RETURN);
  assert.deepEqual(FC.frozenFields(reason), NAMED);
  assert.deepEqual(W.validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  const plain = frozenFeed(W, new Map()).rows[0];
  for (const k of NAMED) assert.notEqual(plain[k], undefined, 'without a run the row keeps ' + k);
  // Only one field shown: singular verb and singular return sentence, and the guard sees only that field.
  const one = otcSnapshot('ONE'); one.metrics = {};
  const oneRow = frozenFeed(W, new Map([['ONE', { since: '2026-09-29', days: 39 }]]), [one]).rows[0];
  const oneReason = oneRow.aus.find(a => a.endsWith(FC.FROZEN_CLOSE_RETURN));
  assert.equal(oneReason, 'Börsenwert wird nicht gezeigt, weil der Schlusskurs dieser OTC-Notierung mindestens seit dem 29.09.2026 '
    + 'unverändert ist (39 Handelstage). Ein so lange unveränderter Kurs ist kein aktueller Marktpreis. Der Wert kommt ' + FC.FROZEN_CLOSE_RETURN);
  assert.deepEqual(FC.frozenFields(oneReason), ['mc']);
  assert.deepEqual(FC.frozenFields('Börsenwert wird nicht gezeigt, weil etwas anderes. ' + 'x'), []);
});

check('frozen: a row without a market cap withholds the price values it shows (AUHEF class), the reason names only them', () => {
  const noCap = otcSnapshot('AUHEF'); noCap.marketCap = { value: null };
  const run = new Map([['AUHEF', { since: '2026-09-29', days: 39 }]]);
  const plain = frozenFeed(W, new Map(), [noCap]).rows[0];
  const shown = NAMED.filter(k => plain[k] !== undefined);
  assert.ok(shown.includes('d52') && shown.includes('dy') && !shown.includes('mc'), 'fixture shows d52 and dy without mc: ' + shown);
  const feed = frozenFeed(W, run, [noCap]);
  const row = feed.rows[0];
  for (const k of NAMED) assert.equal(row[k], undefined, k);
  const reason = row.aus.find(a => a.endsWith(FC.FROZEN_CLOSE_RETURN));
  assert.deepEqual(FC.frozenFields(reason), shown, 'exactly the fields that were shown');
  assert.deepEqual(W.validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  // A frozen row that shows no price value gets no reason at all.
  const bare = otcSnapshot('BARE'); bare.marketCap = { value: null }; bare.metrics = {};
  assert.equal(frozenFeed(W, new Map([['BARE', { since: '2026-09-29', days: 39 }]]), [bare]).rows[0].aus
    .some(a => a.endsWith(FC.FROZEN_CLOSE_RETURN)), false);
  const blind = compiled(FILES[0], '  if (!run) return;', '  if (!run || row.mc === null || row.mc === undefined) return;');
  assert.notEqual(frozenFeed(blind, run, [noCap]).rows[0].d52, undefined, 'broken: the old market-cap condition shows d52 again');
});

check('frozen: break once, the check refuses a named field beside the reason and the writer without the hold shows it', () => {
  const feed = frozenFeed(W, new Map([['TOKSF', { since: '2026-09-29', days: 39 }]]));
  const back = structuredClone(feed); back.rows[0].mc = 920092096;
  assert.ok(W.validateUniverse(back, Buffer.byteLength(JSON.stringify(back))).includes('TOKSF: price value beside a frozen-close hold'));
  const blind = compiled(FILES[0], '    withholdFrozen(row, frozenCloses.get(ticker));', '');
  assert.equal(frozenFeed(blind, new Map([['TOKSF', { since: '2026-09-29', days: 39 }]])).rows[0].mc, 920092096, 'broken writer shows the frozen cap');
});

// ── growth ──────────────────────────────────────────────────────────────────
const china = Object.keys(EQ.snapshots).filter(t => /\.(SS|SZ)$/.test(t));
const handTable = new Set(['000688.SZ', '301297.SZ', '000599.SZ', '600292.SS', '601211.SS']);
check('growth: every filing-checked wrong row without a hand table is mixed, every other China row agrees', () => {
  const must = new Set(EQ.mustWithhold);
  for (const t of china) {
    const res = X.shownGrowthCheck(structuredClone(EQ.snapshots[t]));
    if (handTable.has(t)) assert.equal(res.why, 'hand-table', t);
    else assert.equal(res.status, must.has(t) ? 'mixed' : 'agree', t + ' ' + JSON.stringify(res));
  }
  assert.ok(china.filter(t => must.has(t) && !handTable.has(t)).length >= 15, 'enough wrong rows in the fixture');
  assert.equal(X.shownGrowthCheck({ meta: { ticker: 'LPG' } }), null, 'outside China nothing is checked');
});

check('growth: the writer withholds g and r40 with the German reason; an agreeing row keeps g', () => {
  const rowOf = t => W.buildUniverse({ snapshots: [structuredClone(EQ.snapshots[t])], excluded: new Map([[t, ['test']]]),
    generatedAt: FRESH }).rows[0];
  const wrong = rowOf('601377.SS');
  assert.equal(wrong.g, undefined);
  assert.ok(wrong.aus.some(a => /^Umsatzwachstum (?:und Rule of 40 werden|wird) nicht gezeigt, weil das Wachstum nicht zu den Umsätzen der Börsenmeldung \(Eastmoney\) für dieselben Zeiträume passt \(Quartal bis 30\.06\.2026 gegen 30\.06\.2025, Abweichung mehr als 2 Prozentpunkte und mehr als 5 % des Wachstums laut Börsenmeldung\)\.$/.test(a)), wrong.aus.join(' | '));
  assert.notEqual(rowOf('601901.SS').g, undefined, 'an agreeing broker keeps its growth');
  assert.equal(W.growthReason({ basis: 'year', periodEnd: '2025-12-31', priorPeriodEnd: '2024-12-31' }, true),
    'Umsatzwachstum und Rule of 40 werden nicht gezeigt, weil das Wachstum nicht zu den Umsätzen der Börsenmeldung (Eastmoney) für dieselben Zeiträume passt (Geschäftsjahr bis 31.12.2025 gegen 31.12.2024, Abweichung mehr als 2 Prozentpunkte und mehr als 5 % des Wachstums laut Börsenmeldung).');
});

check('growth + np (Tag 1573): a withheld growth carries no newer-period label, a shown one does; break once, label before the hold', () => {
  const anchor = '      revGrowth: row.g === null || row.g === undefined ? null : board ? board.revGrowthPeriodEnd : revGrowthLeg(snapshot).periodEnd,';
  const before = process.env.RUN_DATE_UTC;
  process.env.RUN_DATE_UTC = '2026-11-21';
  try {
    const feedOf = (builder, t) => {
      const s = structuredClone(EQ.snapshots[t]);
      s.meta.mostRecentQuarter = '2026-09-30'; // a newer quarter is published than the shown 30.06.2026
      const feed = builder.buildUniverse({ snapshots: [s], excluded: new Map([[t, ['test']]]), generatedAt: FRESH });
      return { row: feed.rows[0], npErrors: W.validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))).filter(e => e.endsWith('invalid np')) };
    };
    const wrong = feedOf(W, '601377.SS'), agree = feedOf(W, '601901.SS');
    assert.equal(wrong.row.g, undefined);
    assert.equal(wrong.row.np, undefined, 'no label on a growth the row no longer shows');
    assert.deepEqual(wrong.npErrors, []);
    assert.notEqual(agree.row.g, undefined);
    assert.ok(typeof agree.row.np === 'string' && agree.row.np.startsWith('2026-09-30'), 'a shown stale growth keeps its label: ' + agree.row.np);
    const early = compiled(FILES[0], anchor, '      revGrowth: g === null ? null : board ? board.revGrowthPeriodEnd : revGrowthLeg(snapshot).periodEnd,');
    const broken = feedOf(early, '601377.SS');
    assert.equal(typeof broken.row.np, 'string', 'labelled before the hold, the withheld growth keeps a label');
    assert.equal(broken.npErrors.length, 1, 'and the validator refuses it');
  } finally {
    if (before === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = before;
  }
});

check('growth: break once, a check that always agrees lets the wrong rows through', () => {
  const blind = compiled(FILES[3], "  out.status = out.exchangePct.some(near) ? 'agree' : 'mixed';", "  out.status = 'agree';");
  assert.equal(blind.shownGrowthCheck(structuredClone(EQ.snapshots['601377.SS'])).status, 'agree');
  assert.equal(X.shownGrowthCheck(structuredClone(EQ.snapshots['601377.SS'])).status, 'mixed');
});

check('growth: exchangeValues reads the same exchange figures evaluate() compares, pair by pair, on the fixture', () => {
  const EQC = require('../lib/exchange-quarter-check.js');
  const ctx = EQC.defaultContext();
  let quarters = 0, years = 0;
  for (const t of china) {
    const res = EQC.evaluate(structuredClone(EQ.snapshots[t]), ctx);
    if (!res?.stratum || !res.line) continue;
    const values = X.exchangeValues(ctx.stores.cn, t, [res.line]);
    assert.ok(values, t + ': chain readable where evaluate() read it');
    for (const p of res.pairs) {
      assert.deepEqual([values[res.line].quarter[p.end] ?? null, values[res.line].quarter[p.priorEnd] ?? null], p.exchange, t + ' ' + p.end);
      quarters++;
    }
    if (Array.isArray(res.growth?.periodsChecked) && Array.isArray(res.growth.exchange)) {
      assert.deepEqual(res.growth.periodsChecked.map(e => values[res.line].fy[e] ?? null), res.growth.exchange, t + ' full years');
      years++;
    }
  }
  assert.ok(quarters >= 30, 'enough compared pairs: ' + quarters);
  console.log('  compared ' + quarters + ' quarter pairs and ' + years + ' full-year pairs');
});

// ── ebitda ──────────────────────────────────────────────────────────────────
// Dorian LPG on 21.11.2026: four quarters to 30.09.2026, operating margin 72.3 %, Yahoo EBITDA margin 67.49 %.
const ENDS = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'];
const lpg = (over = {}) => {
  const s = snapshot({ ticker: 'LPG', revenueTTM: 679035712, ebitdaMargins: 67.49, fcfMarginTTM: 38.6, fcfMarginTTMPeriodEnd: '2026-09-30',
    revenueQ: [221347756, 187884848, 153270708, 119964287, 124064281].map(value => ({ value })), revenueQEnds: ENDS, ...over });
  s.timeseries.opIncQ = (over.opIncQ || [215455939, 142664853, 83928000, 51310955, 59344745]).map(value => ({ value }));
  s.timeseries.opIncQEnds = over.opIncQEnds || ENDS;
  return s;
};
check('ebitda: a margin under the operating margin of the same four quarters is withheld, other readings are not', () => {
  assert.equal(R.ebitdaUnterBetriebsergebnis(lpg()), true);
  assert.equal(R.ebitdaMargePct(lpg(), 78.4), null);
  assert.equal(R.ebitdaUnterBetriebsergebnis(lpg({ ebitdaMargins: 70.4 })), false, 'within 2 points of the operating margin');
  assert.equal(R.ebitdaUnterBetriebsergebnis(lpg({ revenueTTM: 600e6 })), false, 'Yahoo twelve months are another period');
  assert.equal(R.ebitdaUnterBetriebsergebnis(lpg({ opIncQEnds: ['2026-06-30', ...ENDS.slice(1)] })), false, 'other quarter ends');
  assert.equal(R.ebitdaUnterBetriebsergebnis(lpg({ opIncQ: [215455939, null, 83928000, 51310955, 59344745] })), false, 'a gap');
  assert.equal(R.ebitdaUnterBetriebsergebnis(lpg({ revenueQEnds: ['2026-09-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
    opIncQEnds: ['2026-09-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] })), false, 'not four consecutive quarters');
  assert.equal(R.ebitdaMargePct(lpg({ ebitdaMargins: 75 }), 78.4), 75);
  // The reason names only this cause: a margin already dropped as a unit error (fraction instead of percent) gets none.
  assert.equal(R.ebitdaGrund(lpg(), 78.4), R.EBITDA_GRUND);
  assert.equal(R.ebitdaMargePct(lpg({ ebitdaMargins: 0.5 }), 0.3), null);
  assert.equal(R.ebitdaGrund(lpg({ ebitdaMargins: 0.5 }), 0.3), null, 'unit error, not under the operating margin');
  assert.equal(R.ebitdaGrund(lpg({ ebitdaMargins: 75 }), 78.4), null);
  assert.match(R.EBITDA_GRUND, /^EBITDA-Marge und Rule of 40 mit EBITDA werden nicht gezeigt/);
  const blind = compiled(FILES[1], "  return istZahl(e) && !einheitenVerdacht(wachstumRoh, e) && ebitdaUnterBetriebsergebnis(snapshot) ? EBITDA_GRUND : null;",
    '  return ebitdaUnterBetriebsergebnis(snapshot) ? EBITDA_GRUND : null;');
  assert.equal(blind.ebitdaGrund(lpg({ ebitdaMargins: 0.5 }), 0.3), blind.EBITDA_GRUND, 'broken: the unit error gets the wrong reason');
});

check('ebitda: the Rule of 40 board carries the reason and no EBITDA number, and its check holds both', () => {
  const f = baueExport([{ row: boardZeile({ ticker: 'LPG', revGrowthYoYPct: 78.4 }), snap: lpg(), branch: 'energy', reihe: false }],
    { generatedAt: '2026-11-21T11:22:31.786Z' });
  try {
    R.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
    const file = path.join(f.outDir, 'overview.json');
    const overview = JSON.parse(fs.readFileSync(file, 'utf8'));
    const row = overview.rows.find(r => r.ticker === 'LPG');
    assert.equal(row.ebitdaMarginPct, null); assert.equal(row.r40Ebitda, null);
    assert.equal(row.ebitdaMarginReason, R.EBITDA_GRUND);
    assert.ok(Number.isFinite(row.r40), 'r40 itself stays');
    const errorsOf = () => R.check({ v1Dir: f.v1Dir, outDir: f.outDir }).errors.filter(e => e.includes('ebitdaMarginReason'));
    assert.deepEqual(errorsOf(), []);
    row.ebitdaMarginPct = 67.5; fs.writeFileSync(file, JSON.stringify(overview));
    assert.equal(errorsOf().length, 1, 'a number beside the reason is refused');
    // Cap: one reason on a one-row board is allowed (ceil of 5 %), two of two are not.
    row.ebitdaMarginPct = null;
    overview.rows.push({ ...row, ticker: 'LPG2' }); fs.writeFileSync(file, JSON.stringify(overview));
    const cap = /^\[rule40\] 2 von 2 Zeilen tragen ebitdaMarginReason, erlaubt sind hoechstens 1 \(5 %\)/;
    assert.ok(errorsOf().some(e => cap.test(e)), errorsOf().join(' | '));
    const uncapped = compiled(FILES[1], '  if (ohneEbitda > Math.ceil(EBITDA_GRUND_MAX_ANTEIL * rows.length)) {', '  if (false) {');
    assert.equal(uncapped.check({ v1Dir: f.v1Dir, outDir: f.outDir }).errors.some(e => cap.test(e)), false, 'broken: no cap, no error');
  } finally { f.aufraeumen(); }
});

check('ebitda: break once, without the contradiction check the wrong margin is shown again', () => {
  const blind = compiled(FILES[1], '  return e < 100 * ergebnis.summe / umsatz.summe - EBITDA_TOLERANZ_PP;', '  return false;');
  assert.equal(blind.ebitdaMargePct(lpg(), 78.4), 67.49);
});

for (const [f, h] of hashes) assert.equal(sha(f), h, 'live file unchanged: ' + f);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`withhold-wrong-values: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
