'use strict';
/** tests/card-contract-fields.test.js — standalone runner (node tests/card-contract-fields.test.js, exit 0/1).
 * Card data contract (23.11.2026, findash S7 company card): athReason, price12m and the FCF margin on
 * every board row. Every value has its reason exactly when it is null, never a 0; a shown value
 * carries its own dates and source; the check catches a value without reason or period. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolated stores BEFORE the export module reads its directories at load time.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-contract-'));
const snapDir = path.join(tmp, 'snapshots');
const pricesDir = path.join(tmp, 'prices');
fs.mkdirSync(snapDir);
process.env.FINDASH_SNAPSHOTS_DIR = snapDir;
process.env.FINDASH_PRICES_DIR = pricesDir;

const store = require('../lib/price-history-store.js');
const { price12mFor } = require('../lib/price12m.js');
const { athReasonFor } = require('../scripts/update-ath-state.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('price12m: start is the last close ON or BEFORE the day one year back', () => {
  // 2025-11-22 is a Saturday: start = Friday 21.11. (80), not Monday 24.11. (120).
  const s = [{ date: '2025-11-20', close: 70 }, { date: '2025-11-21', close: 80 }, { date: '2025-11-24', close: 120 }, { date: '2026-11-22', close: 100 }];
  const r = price12mFor(s);
  assert.deepEqual(r.price12m, { fromDate: '2025-11-21', fromClose: 80, toDate: '2026-11-22', toClose: 100, changePct: 25, source: 'yahoo-adjclose' });
  assert.equal(r.price12mReason, null);
  assert.deepEqual(price12mFor([...s].reverse()), r, 'unsorted input gives the same result');
  assert.equal(price12mFor([{ date: '2025-11-21', close: 200 }, { date: '2026-11-21', close: 150 }]).price12m.changePct, -25);
});

test('price12m: 7 days back is a start, 8 days back is a gap; short or empty series has a reason', () => {
  assert.equal(price12mFor([{ date: '2025-11-14', close: 50 }, { date: '2026-11-21', close: 100 }]).price12m.changePct, 100);
  const gap = price12mFor([{ date: '2025-11-13', close: 50 }, { date: '2026-11-21', close: 100 }]);
  assert.equal(gap.price12m, null);
  assert.match(gap.price12mReason, /fehlen die Tage um den 2025-11-21/);
  assert.match(price12mFor([{ date: '2026-03-02', close: 1 }, { date: '2026-11-21', close: 2 }]).price12mReason, /beginnt erst am 2026-03-02/);
  assert.match(price12mFor(undefined).price12mReason, /Keine Kursreihe/);
  // Impossible days and non-positive closes are dropped, never read as 0.
  const r = price12mFor([{ date: '2025-11-21', close: 50 }, { date: '2026-11-21', close: 100 }, { date: '2026-13-01', close: 1 }, { date: '2026-02-30', close: 1 }, { date: '2026-11-22', close: 0 }]);
  assert.equal(r.price12m.changePct, 100);
  assert.equal(r.price12m.toDate, '2026-11-21');
});

test('athReason: one sentence exactly when displayFor gives no ATH', () => {
  const ok = { ath: 10, athDate: '2026-01-02', lastClose: 8, lastDate: '2026-11-20' };
  assert.equal(athReasonFor(ok), null);
  assert.match(athReasonFor(undefined), /noch nicht ermittelt/);
  assert.match(athReasonFor({ ...ok, needsReseed: true }), /Split/);
  assert.match(athReasonFor({ ...ok, athDate: '2026-11-21' }), /älter als der Tag des Allzeithochs/);
  assert.match(athReasonFor({ ...ok, ath: null }), /unvollständig/);
});

const exp = require('../scripts/write-findash-export.js');

const snap = (metric, extra = {}) => ({
  meta: { ...(extra.meta || {}) },
  metrics: metric === undefined ? {} : { fcfMarginTTM: metric },
  annual: { annualFCF: extra.fcf ?? [{ value: 5e8 }], annualOCF: [{ value: 7e8 }] },
});

test('FCF margin: shown only with a TTM source and its period; every refusal has a reason', () => {
  assert.deepEqual(exp.fcfAnzeigeAus(snap({ value: 12.345, source: 'sec-ttm', periodEnd: '2026-09-30' })),
    { fcfMarginPct: 12.3, fcfMarginSource: 'sec-ttm', fcfMarginPeriodEnd: '2026-09-30', fcfMarginReason: null });
  const leer = (s) => { const r = exp.fcfAnzeigeAus(s); assert.equal(r.fcfMarginPct, null); assert.equal(r.fcfMarginSource, null); assert.equal(r.fcfMarginPeriodEnd, null); return r.fcfMarginReason; };
  assert.match(leer(null), /Keine Firmendaten/);
  assert.match(leer(snap({ value: 12, source: 'sec-ttm', periodEnd: '2026-09-30' }, { meta: { fcfMarginTTMSuppressed: true } })), /zurückgehalten/);
  assert.match(leer(snap(undefined, { meta: { fcfMarginTTMReason: 'sec-stale' } })), /veraltet/);
  assert.match(leer(snap(undefined)), /Keine FCF-Marge/);
  assert.match(leer(snap({ value: -12, source: 'sec-ttm', periodEnd: '2026-09-30' })), /nicht belastbar/, 'sign against the newest FCF year (G2)');
  assert.match(leer(snap({ value: 140, source: 'sec-ttm', periodEnd: '2026-09-30' })), /über dem Umsatz/);
  assert.match(leer(snap({ value: 12, source: 'yahoo_quoteSummary', periodEnd: '2026-09-30' })), /ohne bekannte Zwölfmonatsquelle/);
  assert.match(leer(snap({ value: 12, source: 'yahoo-fts-ttm', periodEnd: null })), /ohne Zeitraum/);
});

test('kartenFelder: real store and snapshot reach the row fields', () => {
  const t = 'ZZCARD';
  store.saveAll(pricesDir, { [t]: [{ date: '2025-11-21', close: 40 }, { date: '2026-11-20', close: 50 }, { date: '2026-11-21', close: 60 }] });
  fs.writeFileSync(path.join(snapDir, safeSnapshotFilename(t)), JSON.stringify(snap({ value: 8.04, source: 'yahoo-fts-ttm', periodEnd: '2026-06-30' })));
  const f = exp.kartenFelder(t, 'main');
  assert.match(f.athReason, /noch nicht ermittelt/, 'a ticker without state entry');
  assert.deepEqual(f.price12m, { fromDate: '2025-11-21', fromClose: 40, toDate: '2026-11-21', toClose: 60, changePct: 50, source: 'yahoo-adjclose' });
  assert.equal(f.price12mReason, null);
  assert.equal(f.fcfMarginPct, 8);
  assert.equal(f.fcfMarginPeriodEnd, '2026-06-30');
  assert.deepEqual(Object.keys(exp.athUndKurs(t)), ['ath', 'athReason', 'price12m', 'price12mReason']);
  assert.equal(exp.athUndKurs(t).ath, null);
});

test('check: a value without reason, a reason next to a value, a changePct that does not follow, an FCF margin without period', () => {
  const gut = { ath: null, athReason: 'x', price12m: { fromDate: '2025-11-21', fromClose: 40, toDate: '2026-11-21', toClose: 60, changePct: 50, source: 'yahoo-adjclose' },
    price12mReason: null, fcfMarginPct: 8, fcfMarginSource: 'sec-ttm', fcfMarginPeriodEnd: '2026-09-30', fcfMarginReason: null };
  const fehler = (r) => { const e = []; exp.checkKartenFelder(r, 'row', e); return e; };
  assert.deepEqual(fehler(gut), []);
  assert.equal(fehler({ ...gut, athReason: null }).length, 1);
  assert.equal(fehler({ ...gut, ath: { distancePct: -3 } }).length, 1, 'reason next to a shown ATH');
  assert.equal(fehler({ ...gut, price12m: { ...gut.price12m, changePct: 0 } }).length, 1);
  assert.equal(fehler({ ...gut, price12m: null }).length, 1, 'null price12m without reason');
  assert.equal(fehler({ ...gut, fcfMarginPeriodEnd: null }).length, 1);
  assert.equal(fehler({ ...gut, fcfMarginPct: null }).length, 2, 'source without margin and no reason');
  assert.deepEqual(fehler({ ticker: 'OLD' }), [], 'older rows without the fields stay legal');
});

test('empty price store: named as a store problem for every row, not as a missing series', () => {
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', `
    process.env.FINDASH_PRICES_DIR = ${JSON.stringify(path.join(tmp, 'no-prices'))};
    process.env.FINDASH_SNAPSHOTS_DIR = ${JSON.stringify(snapDir)};
    const e = require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'write-findash-export.js'))});
    process.stdout.write(JSON.stringify(e.athUndKurs('ZZCARD')));`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const r = JSON.parse(child.stdout);
  assert.equal(r.price12m, null);
  assert.match(r.price12mReason, /Kursspeicher leer oder nicht lesbar/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`card-contract-fields: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
