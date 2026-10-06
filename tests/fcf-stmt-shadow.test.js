'use strict';
// P87 (06.10.2026): FCF shadow from Yahoo's annual cash-flow statement, shadow only.
// (A) fcfMarginStmtFY: value only when FCF and revenue share the same dated fiscal-year end;
//     every other case is null with a reason code; never a fallback to fcfMarginTTM, never 0
//     for a missing value, a real 0 stays 0, a negative FCF stays negative.
// (B) Rule-of-X shadow and the authority guard column.
// (C) Rule of 40 rows: fcfShadow is additive, a missing shadow is null and never 0 (the local
//     round1 of write-rule40-export.js turns null into 0, the shadow must not).
// (D) HyperGrowth board rows: buildBoard adds fcfShadow as the LAST key and every other field is
//     exactly what mapBoardRow produced (no visible number changes).
// Hermetic: temp dirs only, no network, no real snapshots.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcf-stmt-shadow-'));
const snapDir = path.join(tmp, 'snapshots');
const srcDir = path.join(tmp, 'hypergrowth');
fs.mkdirSync(snapDir); fs.mkdirSync(srcDir);
process.env.FINDASH_SNAPSHOTS_DIR = snapDir;
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = path.join(tmp, 'snapshots-smallcap');

const SH = require('../lib/fcf-stmt-shadow.js');
const R40 = require('../scripts/write-rule40-export.js');
const W = require('../scripts/write-findash-export.js');

let ok = 0;
function check(name, fn) { fn(); ok++; console.log('  ok   ' + name); }

const snap = (o = {}) => ({
  meta: { ticker: o.ticker || 'TST', reportingCurrency: 'USD', tradingCurrency: 'USD' },
  marketCap: { value: 5e9 },
  metrics: { fcfMarginTTM: o.fd === undefined ? { value: 38.1 } : (o.fd === null ? undefined : { value: o.fd }) },
  annual: Object.assign({
    annualFCF: [{ value: 'fcf' in o ? o.fcf : 200 }, { value: 120 }],
    annualOCF: [{ value: 260 }, { value: 170 }],
    annualRev: [{ value: 'rev' in o ? o.rev : 1000 }, { value: 800 }],
  }, o.ends === false ? {} : {
    annualFCFEnds: [o.fcfEnd || '2025-12-31', '2024-12-31'],
    annualRevEnds: [o.revEnd || '2025-12-31', '2024-12-31'],
  }),
  timeseries: o.timeseries || {},
});

// ---------------------------------------------------------------- (A)
check('A1 same fiscal-year end -> FY value 20 %, reason ok', () => {
  const r = SH.fcfMarginStmtFY(snap());
  assert.equal(r.value, 20); assert.equal(r.grund, 'ok'); assert.equal(r.gjEnde, '2025-12-31');
});
check('A2 different fiscal-year ends -> null + fy-end-mismatch', () => {
  const r = SH.fcfMarginStmtFY(snap({ fcfEnd: '2024-12-31' }));
  assert.equal(r.value, null); assert.equal(r.grund, 'fy-end-mismatch');
});
check('A3 no dated end -> null + fy-end-missing, NO fallback to fcfMarginTTM (38.1)', () => {
  const r = SH.fcfMarginStmtFY(snap({ ends: false }));
  assert.equal(r.value, null); assert.equal(r.grund, 'fy-end-missing');
  assert.notEqual(r.value, 38.1);
});
check('A4 ends from meta.statementPeriods are accepted', () => {
  const s = snap({ ends: false });
  s.meta.statementPeriods = { annualFCF: [{ end: '2025-06-30' }], annualRev: [{ end: '2025-06-30' }] };
  const r = SH.fcfMarginStmtFY(s);
  assert.equal(r.value, 20); assert.equal(r.gjEnde, '2025-06-30');
});
check('A5 missing FCF / missing revenue / revenue 0 -> null with distinct reasons', () => {
  assert.equal(SH.fcfMarginStmtFY(snap({ fcf: null })).grund, 'fcf-missing');
  assert.equal(SH.fcfMarginStmtFY(snap({ rev: null })).grund, 'revenue-missing');
  const z = SH.fcfMarginStmtFY(snap({ rev: 0 }));
  assert.equal(z.grund, 'revenue-nonpositive'); assert.equal(z.value, null);
});
check('A6 negative FCF stays negative, a real 0 stays 0 (not null)', () => {
  assert.equal(SH.fcfMarginStmtFY(snap({ fcf: -50 })).value, -5);
  const z = SH.fcfMarginStmtFY(snap({ fcf: 0 }));
  assert.equal(z.value, 0); assert.equal(z.grund, 'ok');
});
check('A8 T1: statement periods with different currencies -> null + currency-mismatch', () => {
  const s = snap();
  s.meta.statementPeriods = { annualFCF: [{ end: '2025-12-31', duration: '12M', currency: 'INR' }], annualRev: [{ end: '2025-12-31', duration: '12M', currency: 'USD' }] };
  const r = SH.fcfMarginStmtFY(s);
  assert.equal(r.value, null); assert.equal(r.grund, 'currency-mismatch');
});
check('A9 a documented period that is not a full year -> null + period-not-12m', () => {
  const s = snap();
  s.meta.statementPeriods = { annualFCF: [{ end: '2025-12-31', duration: '6M', currency: 'USD' }], annualRev: [{ end: '2025-12-31', duration: '12M', currency: 'USD' }] };
  assert.equal(SH.fcfMarginStmtFY(s).grund, 'period-not-12m');
});
check('A10 T1: annual revenue leaked in foreign currency (INFY-type, ~88x) -> null + currency-leak', () => {
  const s = snap({ rev: 88000 });
  s.meta.reportingCurrencyOriginal = 'INR'; s.meta.tradingCurrency = 'USD';
  s.timeseries = { revenueQ: [{ value: 250 }, { value: 250 }, { value: 250 }, { value: 250 }] };
  s.metrics.revenueTTM = { value: 1000 };
  const r = SH.fcfMarginStmtFY(s);
  assert.equal(r.value, null); assert.equal(r.grund, 'currency-leak');
});
check('A7 the input snapshot is never mutated', () => {
  const s = snap(); const before = JSON.stringify(s);
  SH.fcfMarginStmtFY(s); SH.ruleOfXSchatten(s, 2, null); SH.snapshotMitMarge(s, 12);
  assert.equal(JSON.stringify(s), before);
});

// ---------------------------------------------------------------- (B)
check('B1 snapshotMitMarge replaces only fcfMarginTTM; null removes it', () => {
  const s = snap();
  assert.equal(SH.snapshotMitMarge(s, 20).metrics.fcfMarginTTM.value, 20);
  assert.equal(SH.snapshotMitMarge(s, null).metrics.fcfMarginTTM, undefined);
  assert.equal(SH.snapshotMitMarge(s, 20).annual, s.annual);
});
check('B2 authority guard: same year -> distance in pp; other year -> no distance', () => {
  const e = { quelle: 'sec-secannual.json', nfy: 2025, annualFCF: [{ value: 190 }], annualRev: [{ value: 1000 }] };
  const sh = SH.fcfMarginStmtFY(snap());
  const g = SH.behoerdenSchutz(e, sh);
  assert.equal(g.gleichesJahr, true); assert.equal(Math.round(g.abstandPp * 10) / 10, 1);
  const g2 = SH.behoerdenSchutz({ ...e, nfy: 2024 }, sh);
  assert.equal(g2.gleichesJahr, false); assert.equal(g2.abstandPp, null);
  assert.deepEqual(SH.behoerdenSchutz(undefined, sh), { marge: null, geschaeftsjahr: null, quelle: null, gleichesJahr: null, abstandPp: null });
});
check('B4 without an FY margin ruleOfXShadow is null (missing data is not a formula change)', () => {
  const b = SH.boardSchatten(snap({ ends: false }), 2, null, undefined);
  assert.equal(b.fcfMarginStmtFY, null); assert.equal(b.ruleOfXShadow, null); assert.equal(b.schattenFcfAktiv, false);
});
check('B3 boardSchatten without a known formula leaves Rule-of-X null, keeps the margin', () => {
  const b = SH.boardSchatten(snap(), null, null, undefined);
  assert.equal(b.fcfMarginStmtFY, 20); assert.equal(b.ruleOfXHeute, null); assert.equal(b.ruleOfXShadow, null);
});

// ---------------------------------------------------------------- (C)
check('C1 R40: no shadow on a hand-built candidate -> fcfShadow null', () => {
  assert.equal(R40.r40SchattenZeile({ wachstum: 50 }), null);
});
check('C2 R40: valid shadow -> r40Shadow = clamped growth + FY margin', () => {
  const s = snap(); const sh = SH.fcfMarginStmtFY(s);
  const z = R40.r40SchattenZeile({ wachstum: 50, fcfSchatten: sh, fcfSchattenTor: R40.r40SchattenTor(sh, 60, s) });
  assert.equal(z.r40Shadow, 70); assert.equal(z.r40ShadowGrund, 'ok'); assert.equal(z.fcfMarginStmtFY, 20);
});
check('C3 R40: missing shadow stays null, never 0 (T2 against the local round1)', () => {
  const s = snap({ ends: false }); const sh = SH.fcfMarginStmtFY(s);
  const z = R40.r40SchattenZeile({ wachstum: 50, fcfSchatten: sh, fcfSchattenTor: R40.r40SchattenTor(sh, 60, s) });
  assert.equal(z.fcfMarginStmtFY, null); assert.equal(z.r40Shadow, null);
  assert.equal(z.r40ShadowGrund, 'fy-end-missing'); assert.equal(z.behoerdeFcfMarginFY, null);
});
check('C4 R40: shadow above 100 % of revenue fails the same gate as today, no r40Shadow', () => {
  // The sign gate G2 can never drop the shadow (it IS the newest FCF year); the size gate can.
  const s = snap({ fcf: 1500 }); s.annual.annualFCF = [{ value: 1500 }, { value: 120 }];
  const sh = SH.fcfMarginStmtFY(s);
  assert.equal(sh.value, 150);
  const tor = R40.r40SchattenTor(sh, 60, s);
  assert.equal(tor, 'fcf-above-revenue');
  const z = R40.r40SchattenZeile({ wachstum: 50, fcfSchatten: sh, fcfSchattenTor: tor });
  assert.equal(z.r40Shadow, null); assert.equal(z.fcfMarginStmtFY, 150);
});
check('C5 R40: baueZeilen keeps every existing field, fcfShadow is purely additive', () => {
  const s = snap(); const sh = SH.fcfMarginStmtFY(s);
  const k = { ticker: 'TST', snapshot: { meta: s.meta, marketCap: s.marketCap }, row: null, branch: 'semiconductors', track: 'profitable',
    onBoard: false, marketCap: 5e9, meta: { longName: 'Test', country: 'US', sector: 'Technology', industry: 'Semiconductors' },
    wachstumRoh: 60, fcfMarginPct: 38.1, ebitdaMarginPct: null, industry: 'Semiconductors', quartalsEnde: null, wachstumBein: null };
  const ohne = R40.baueZeilen([k]).rows[0];
  const mit = R40.baueZeilen([{ ...k, fcfSchatten: sh, fcfSchattenTor: 'ok' }]).rows[0];
  assert.equal(ohne.fcfShadow, null);
  const { fcfShadow, ...rest } = mit;
  const { fcfShadow: _n, ...restOhne } = ohne;
  assert.deepEqual(rest, restOhne);
  assert.equal(mit.r40, ohne.r40); assert.equal(mit.fcfMarginPct, 38.1);
  assert.equal(fcfShadow.r40Shadow, Math.round((60 + 20) * 10) / 10);
});

// ---------------------------------------------------------------- (D)
check('D1 buildBoard: fcfShadow is the last key, all other fields equal mapBoardRow', () => {
  const s = snap({ ticker: 'TST' });
  fs.writeFileSync(path.join(snapDir, 'TST.json'), JSON.stringify(s));
  const src = { ticker: 'TST', score: 61.2, track: 'profitable', lamps: [], overview: null, name: 'Test Corp', country: 'US',
    coverageAxes: '7/7', coverageWeight: 1, cohortN: 40, scoreBase: 60, scoreShrunk: 59, axisBreakdown: [], revGrowthYoYPct: 60 };
  fs.writeFileSync(path.join(srcDir, 'semiconductors.json'), JSON.stringify({ profitable: [src], unprofitable: [] }));
  const board = W.buildBoard('semiconductors', null, { srcDir });
  const row = board.profitable[0];
  const keys = Object.keys(row);
  assert.equal(keys[keys.length - 1], 'fcfShadow');
  const { fcfShadow, ...rest } = row;
  const expected = W.mapBoardRow(src, 0);
  expected.rank = row.rank; expected.rankGrund = row.rankGrund;
  assert.deepEqual(rest, expected);
  assert.equal(fcfShadow.fcfMarginStmtFY, 20); assert.equal(fcfShadow.grund, 'ok');
  assert.equal(typeof fcfShadow.ruleOfXHeute === 'number' || fcfShadow.ruleOfXHeute === null, true);
});
check('D2 buildBoard: a row without snapshot gets reason no-snapshot, no numbers', () => {
  fs.writeFileSync(path.join(srcDir, 'energy.json'), JSON.stringify({ profitable: [{ ticker: 'NOSNAP', score: 40, track: 'profitable', lamps: [], overview: null }], unprofitable: [] }));
  const z = W.buildBoard('energy', null, { srcDir }).profitable[0].fcfShadow;
  assert.equal(z.grund, 'no-snapshot'); assert.equal(z.fcfMarginStmtFY, null); assert.equal(z.ruleOfXShadow, null);
});

check('D3 buildBoard: an unreadable snapshot is named as such, not as missing', () => {
  fs.writeFileSync(path.join(snapDir, 'BROKEN.json'), '{not json');
  fs.writeFileSync(path.join(srcDir, 'utilities.json'), JSON.stringify({ profitable: [{ ticker: 'BROKEN', score: 30, track: 'profitable', lamps: [], overview: null }], unprofitable: [] }));
  assert.equal(W.buildBoard('utilities', null, { srcDir }).profitable[0].fcfShadow.grund, 'snapshot-unreadable');
});

check('E1 every key of both fcfShadow shapes is in the frozen v1 row-key list (G7 runs only on a real export)', () => {
  const frozen = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'druckenmiller', 'fixtures', 'v1-row-keys.snapshot.json'), 'utf8')));
  const s = snap(); const sh = SH.fcfMarginStmtFY(s);
  const hg = { fcfShadow: SH.boardSchatten(s, 2, null, undefined) };
  const r40 = { fcfShadow: R40.r40SchattenZeile({ wachstum: 50, fcfSchatten: sh, fcfSchattenTor: 'ok' }) };
  const missing = new Set();
  const walk = (v) => { if (Array.isArray(v)) return v.forEach(walk); if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) { if (!frozen.has(k)) missing.add(k); walk(x); } };
  walk(hg); walk(r40);
  assert.deepEqual([...missing], []);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`fcf-stmt-shadow.test.js: ${ok} ok`);
