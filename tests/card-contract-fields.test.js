'use strict';
/** tests/card-contract-fields.test.js — standalone runner (node tests/card-contract-fields.test.js, exit 0/1).
 * Card data contract (23.11.2026, findash S7 company card): athReason, price12m and the FCF margin on
 * every board row. A null value carries a reason code exactly when it is null, never a 0; a shown value
 * carries its own dates and source; the check catches a value without reason, period or window; the row
 * mappers and the rule40 rows really carry the keys. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

// Isolated stores BEFORE the export module reads its directories at load time.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-contract-'));
const snapDir = path.join(tmp, 'snapshots');
const pricesDir = path.join(tmp, 'prices');
fs.mkdirSync(snapDir);
process.env.FINDASH_SNAPSHOTS_DIR = snapDir;
process.env.FINDASH_PRICES_DIR = pricesDir;
delete process.env.RUN_DATE_UTC;

const store = require('../lib/price-history-store.js');
const { price12mFor } = require('../lib/price12m.js');
const { athReasonFor } = require('../scripts/update-ath-state.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const EXPORT = path.join(__dirname, '..', 'scripts', 'write-findash-export.js');
const imKind = (env, code) => {
  const r = childProcess.spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test('price12m: start is the last close ON or BEFORE the day one year back; closes rounded, change from the raw closes', () => {
  // 2025-11-22 is a Saturday: start = Friday 21.11. (80), not Monday 24.11. (120).
  const s = [{ date: '2025-11-20', close: 70 }, { date: '2025-11-21', close: 80 }, { date: '2025-11-24', close: 120 }, { date: '2026-11-22', close: 100 }];
  const r = price12mFor(s);
  assert.deepEqual(r.price12m, { fromDate: '2025-11-21', fromClose: 80, toDate: '2026-11-22', toClose: 100, changePct: 25, source: 'yahoo-price-store' });
  assert.equal(r.price12mReason, null);
  assert.deepEqual(price12mFor([...s].reverse()), r, 'unsorted input gives the same result');
  assert.equal(price12mFor([{ date: '2025-11-21', close: 200 }, { date: '2026-11-21', close: 150 }]).price12m.changePct, -25);
  const g = price12mFor([{ date: '2025-11-21', close: 24.170000076293945 }, { date: '2026-11-21', close: 21.850000381469727 }]).price12m;
  assert.deepEqual([g.fromClose, g.toClose, g.changePct], [24.17, 21.85, -9.6]);
});

test('price12m: 12 days back is a start, 13 is a gap; codes for short, empty, stale and jumping series', () => {
  assert.equal(price12mFor([{ date: '2025-11-09', close: 50 }, { date: '2026-11-21', close: 100 }]).price12m.changePct, 100);
  assert.equal(price12mFor([{ date: '2025-11-08', close: 50 }, { date: '2026-11-21', close: 100 }]).price12mReason, 'gap:2025-11-21');
  assert.equal(price12mFor([{ date: '2026-03-02', close: 1 }, { date: '2026-11-21', close: 2 }]).price12mReason, 'short-series:2026-03-02');
  assert.equal(price12mFor(undefined).price12mReason, 'no-series');
  assert.equal(price12mFor([{ date: '2026-11-21', close: 2 }]).price12mReason, 'no-series');
  const alt = [{ date: '2025-08-24', close: 50 }, { date: '2026-08-24', close: 105 }];
  assert.equal(price12mFor(alt, '2026-11-21').price12mReason, 'stale-series:2026-08-24');
  assert.equal(price12mFor(alt, '2026-08-30').price12m.changePct, 110, 'young enough without the age rule');
  assert.equal(price12mFor([{ date: '2025-11-21', close: 10 }, { date: '2026-05-04', close: 40 }, { date: '2026-11-21', close: 40 }]).price12mReason, 'jump');
  // Impossible days and non-positive closes are dropped, never read as 0.
  const r = price12mFor([{ date: '2025-11-21', close: 50 }, { date: '2026-11-21', close: 100 }, { date: '2026-13-01', close: 1 }, { date: '2026-02-30', close: 1 }, { date: '2026-11-22', close: 0 }]);
  assert.equal(r.price12m.toDate, '2026-11-21');
});

test('athReason: a code exactly when displayFor gives no ATH; needsReseed claims no split', () => {
  const ok = { ath: 10, athDate: '2026-01-02', lastClose: 8, lastDate: '2026-11-20' };
  assert.equal(athReasonFor(ok), null);
  assert.equal(athReasonFor(undefined), 'not-seeded');
  assert.equal(athReasonFor({ ...ok, needsReseed: true }), 'reseed-needed');
  assert.equal(athReasonFor({ ...ok, athDate: '2026-11-21' }), 'close-before-ath');
  assert.equal(athReasonFor({ ...ok, ath: null }), 'entry-incomplete');
});

const exp = require('../scripts/write-findash-export.js');
const snap = (metric, extra = {}) => ({
  meta: { ...(extra.meta || {}) },
  metrics: metric === undefined ? {} : { fcfMarginTTM: metric },
  annual: { annualFCF: extra.fcf ?? [{ value: 5e8 }], annualOCF: [{ value: 7e8 }] },
});

test('FCF margin: shown only with a TTM source and its period; every refusal has its code', () => {
  assert.deepEqual(exp.fcfAnzeigeAus(snap({ value: 12.345, source: 'sec-ttm', periodEnd: '2026-09-30' })),
    { fcfMarginPct: 12.3, fcfMarginSource: 'sec-ttm', fcfMarginPeriodEnd: '2026-09-30', fcfMarginReason: null });
  const leer = (s) => { const r = exp.fcfAnzeigeAus(s); assert.equal(r.fcfMarginPct, null); assert.equal(r.fcfMarginSource, null); assert.equal(r.fcfMarginPeriodEnd, null); return r.fcfMarginReason; };
  assert.equal(leer(null), 'no-snapshot');
  assert.equal(leer(snap({ value: 12, source: 'sec-ttm', periodEnd: '2026-09-30' }, { meta: { fcfMarginTTMSuppressed: true } })), 'suppressed');
  assert.equal(leer(snap(undefined, { meta: { fcfMarginTTMReason: 'vendor-ttm-stale' } })), 'stale');
  assert.equal(leer(snap(undefined, { meta: { fcfMarginTTMReason: 'vendor-invalid-entry' } })), 'implausible');
  assert.equal(leer(snap(undefined)), 'none');
  assert.equal(leer(snap({ value: -12, source: 'sec-ttm', periodEnd: '2026-09-30' })), 'untrusted', 'sign against the newest FCF year (G2)');
  assert.equal(leer(snap({ value: 140, source: 'sec-ttm', periodEnd: '2026-09-30' })), 'over-revenue');
  assert.equal(leer(snap({ value: -400, source: 'sec-ttm', periodEnd: '2026-09-30' }, { fcf: [{ value: -5e8 }] })), 'implausible');
  assert.equal(leer(snap({ value: 12, source: 'yahoo_quoteSummary', periodEnd: '2026-09-30' })), 'unknown-source');
  assert.equal(leer(snap({ value: 12, source: 'yahoo-fts-ttm', periodEnd: null })), 'no-period');
  for (const c of ['no-snapshot', 'suppressed', 'stale', 'implausible', 'none', 'untrusted', 'over-revenue', 'unknown-source', 'no-period']) assert.ok(exp.FCF_REASON_CODES.includes(c));
});

const T = 'ZZCARD';
store.saveAll(pricesDir, { [T]: [{ date: '2025-11-21', close: 40 }, { date: '2026-11-20', close: 50 }, { date: '2026-11-21', close: 60 }] });
fs.writeFileSync(path.join(snapDir, safeSnapshotFilename(T)), JSON.stringify(snap({ value: 8.04, source: 'yahoo-fts-ttm', periodEnd: '2026-06-30' })));

test('row mappers and the rule40 rows carry the card keys (wiring)', () => {
  const KEYS = ['athReason', 'price12m', 'price12mReason', 'fcfMarginPct', 'fcfMarginSource', 'fcfMarginPeriodEnd', 'fcfMarginReason'];
  const roh = { ticker: T, score: 80, track: 'profitable', lamps: [], overview: { kind: 'gp', value: 0.5, companion: null }, marketCap: null, name: 'Card Test' };
  const zeilen = {
    mapBoardRow: exp.mapBoardRow(roh, 0),
    mapOverviewRow: exp.mapOverviewRow({ ...roh, formulaId: 'software', overviewKind: 'gp', overviewValue: 0.5, overviewCompanion: null }, 0),
    mapSurvivalRow: exp.mapSurvivalRow({ ticker: T, runwayQuarters: 9, lamps: [], marketCap: null, name: 'Card Test' }, 0),
  };
  for (const [name, z] of Object.entries(zeilen)) {
    assert.ok(z, name + ' returned no row');
    for (const k of KEYS) assert.ok(Object.hasOwn(z, k), `${name} lacks ${k}`);
    assert.equal(z.athReason, 'not-seeded', name);
    assert.equal(z.price12m.changePct, 50, name);
    assert.equal(z.fcfMarginPct, 8, name);
  }
  const rule40 = require('../scripts/write-rule40-export.js');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mcap-classes-shadow', 'rule40-before.json'), 'utf8'));
  for (const row of rule40.baueZeilen(structuredClone(fixture.candidates)).rows) {
    for (const k of ['ath', 'athReason', 'price12m', 'price12mReason']) assert.ok(Object.hasOwn(row, k), `rule40 ${row.ticker} lacks ${k}`);
  }
});

test('check: unknown code, reason next to a value, window, source, changePct, FCF bounds and period', () => {
  const gut = { ath: null, athReason: 'not-seeded', price12m: { fromDate: '2025-11-21', fromClose: 40, toDate: '2026-11-21', toClose: 60, changePct: 50, source: 'yahoo-price-store' },
    price12mReason: null, fcfMarginPct: 8, fcfMarginSource: 'sec-ttm', fcfMarginPeriodEnd: '2026-09-30', fcfMarginReason: null };
  const fehler = (r) => { const e = []; exp.checkKartenFelder(r, 'row', e); return e; };
  assert.deepEqual(fehler(gut), []);
  assert.deepEqual(fehler({ ...gut, price12m: null, price12mReason: 'short-series:2026-03-02' }), []);
  assert.equal(fehler({ ...gut, athReason: null }).length, 1);
  assert.equal(fehler({ ...gut, athReason: 'Allzeithoch fehlt' }).length, 1, 'a sentence is no code');
  assert.equal(fehler({ ...gut, ath: { distancePct: -3 } }).length, 1, 'reason next to a shown ATH');
  assert.equal(fehler({ ...gut, price12m: { ...gut.price12m, changePct: 0 } }).length, 1);
  assert.equal(fehler({ ...gut, price12m: { ...gut.price12m, fromDate: '2026-11-01', changePct: 50 } }).length, 1, 'three weeks are no 12 months');
  assert.equal(fehler({ ...gut, price12m: { ...gut.price12m, source: 'erfunden' } }).length, 1);
  assert.equal(fehler({ ...gut, price12m: null }).length, 1, 'null price12m without reason');
  assert.equal(fehler({ ...gut, fcfMarginPeriodEnd: null }).length, 1);
  assert.equal(fehler({ ...gut, fcfMarginPct: -5000 }).length, 1);
  assert.equal(fehler({ ...gut, fcfMarginPct: null }).length, 2, 'source without margin and no reason');
  assert.deepEqual(fehler({ ticker: 'OLD' }), [], 'older rows without the fields stay legal');
});

test('price store problems are named as such for the rows, with a warning, not as a missing series', () => {
  const probe = (dir) => JSON.parse(imKind({ FINDASH_PRICES_DIR: dir, FINDASH_SNAPSHOTS_DIR: snapDir },
    `const e = require(${JSON.stringify(EXPORT)}); process.stdout.write(JSON.stringify(e.athUndKurs(${JSON.stringify(T)})));`).split('\n').filter((l) => l.startsWith('{')).pop());
  assert.equal(probe(path.join(tmp, 'no-prices')).price12mReason, 'store-unreadable', 'no store at all');
  const leer = path.join(tmp, 'empty-prices');
  store.saveAll(leer, {});
  assert.equal(probe(leer).price12mReason, 'store-unreadable', 'stamped store with 0 tickers');
  const teil = path.join(tmp, 'partial-prices');
  store.saveAll(teil, { [T]: [{ date: '2025-11-21', close: 40 }, { date: '2026-11-21', close: 60 }] });
  fs.rmSync(store.shardPath(teil, (store.shardOf(T) + 1) % store.SHARD_COUNT));
  assert.equal(probe(teil).price12mReason, 'store-unreadable', 'a missing shard is a partial checkout (BH-139 rule)');
  const kaputt = path.join(tmp, 'broken-prices');
  store.saveAll(kaputt, { [T]: [{ date: '2025-11-21', close: 40 }, { date: '2026-11-21', close: 60 }] });
  fs.writeFileSync(store.shardPath(kaputt, store.shardOf(T)), '{broken');
  const out = imKind({ FINDASH_PRICES_DIR: kaputt, FINDASH_SNAPSHOTS_DIR: snapDir },
    `const e = require(${JSON.stringify(EXPORT)}); process.stdout.write(JSON.stringify(e.athUndKurs(${JSON.stringify(T)})));`);
  assert.match(out, /::warning::\[card\] price store shard/);
  assert.equal(probe(kaputt).price12mReason, 'store-unreadable', 'an unreadable shard');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`card-contract-fields: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
