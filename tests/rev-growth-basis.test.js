'use strict';
// 01.10.2026 (gap-rule decision, option c): every exported revGrowthYoYPct says which leg
// produced it (revGrowthBasis) and for which period (revGrowthPeriodEnd/PriorPeriodEnd).
// (A) lib/rev-growth-basis.js walks the same branch as revGrowthLevel and returns the same number,
//     on synthetic snapshots for all four bases, including a 9992.HK-type newer-year record.
// (B) the export only labels a number it can reproduce; otherwise the fields stay null.
// (C) the --check guard fires in both directions (presence and absence) on broken test rows.
// (D) on a REAL export (outputs/findash-export/v1 + snapshots/, or REV_GROWTH_V1_DIR and
//     FINDASH_SNAPSHOTS_DIR) every labelled row agrees with a fresh recomputation from its
//     snapshot, and no row with a number is unlabelled. Skips visibly when no export is on disk.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const realV1 = process.env.REV_GROWTH_V1_DIR || path.join(root, 'outputs', 'findash-export', 'v1');
const realSnaps = process.env.FINDASH_SNAPSHOTS_DIR || path.join(root, 'snapshots');
// Hermetic snapshot dirs for (B); the real ones are only read in (D), through realSnaps.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-growth-basis-'));
const tmpMain = path.join(tmp, 'snapshots');
const tmpSmall = path.join(tmp, 'snapshots-smallcap');
fs.mkdirSync(tmpMain); fs.mkdirSync(tmpSmall);
process.env.FINDASH_SNAPSHOTS_DIR = tmpMain;
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = tmpSmall;

const axes = require('../src/scoring/axes.js');
const { revGrowthLeg, REV_GROWTH_BASES } = require('../lib/rev-growth-basis.js');
const W = require('../scripts/write-findash-export.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

const cells = (a) => a.map((x) => (x == null ? null : { value: x }));
const Q_ENDS = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
function snap({ ticker = 'TST', rq = null, rqEnds = Q_ENDS, ar = null, arEnds = undefined, record = null } = {}) {
  const s = { meta: { ticker }, annual: {}, timeseries: {} };
  if (rq) { s.timeseries.revenueQ = cells(rq); if (rqEnds) s.timeseries.revenueQEnds = rqEnds; }
  if (ar) { s.annual.annualRev = cells(ar); if (arEnds !== undefined) s.annual.annualRevEnds = arEnds; }
  if (record) s.meta.annualRevNewerYear = record;
  return s;
}

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const sameAsLevel = (s, leg) => assert.equal(leg.pct, axes.revGrowthLevel(s), 'pct must be exactly revGrowthLevel(s)');

// ---- (A) the helper ------------------------------------------------------------------
check('A1 quarter leg: newest quarter vs the dated year-ago quarter, both ends', () => {
  const s = snap({ rq: [120, 110, 105, 100, 100], ar: [400, 300], arEnds: ['2025-12-31', '2024-12-31'] });
  const leg = revGrowthLeg(s);
  assert.deepEqual({ ...leg, pct: undefined }, { basis: 'quarter', pct: undefined, periodEnd: '2026-06-30', priorPeriodEnd: '2025-06-30' });
  sameAsLevel(s, leg);
});
check('A2 a quarter gap (gap rule) falls to the year leg, dated annual series gives both ends', () => {
  const s = snap({ rq: [120, 110, null, 100, 100], ar: [400, 300], arEnds: ['2025-12-31', '2024-12-31'] });
  const leg = revGrowthLeg(s);
  assert.equal(leg.basis, 'year');
  assert.equal(leg.periodEnd, '2025-12-31');
  assert.equal(leg.priorPeriodEnd, '2024-12-31');
  sameAsLevel(s, leg);
});
check('A3 undated or misaligned annual series: year, period ends null (never guessed)', () => {
  for (const arEnds of [[null, null], undefined, ['2025-12-31'], ['2025-02-30', '2024-12-31']]) {
    const s = snap({ ar: [400, 300], arEnds });
    const leg = revGrowthLeg(s);
    assert.equal(leg.basis, 'year');
    assert.equal(leg.periodEnd, null, JSON.stringify(arEnds));
    if (!(Array.isArray(arEnds) && arEnds.length === 2 && arEnds[1] === '2024-12-31')) assert.equal(leg.priorPeriodEnd, null);
    sameAsLevel(s, leg);
  }
});
check('A4 9992.HK type: a valid newer-year record makes the basis yearNewerRecord with its periods', () => {
  const rec = { end: '2025-12-31', revenue: 38e9, priorEnd: '2024-12-31', priorRevenue: 13.04e9, priorStored: 13.04e9, source: 'quoteSummary' };
  const s = snap({ ticker: '9992.HK', ar: [13.04e9, 6.3e9], arEnds: [null, null], record: rec });
  const leg = revGrowthLeg(s);
  assert.deepEqual([leg.basis, leg.periodEnd, leg.priorPeriodEnd], ['yearNewerRecord', '2025-12-31', '2024-12-31']);
  sameAsLevel(s, leg);
  assert.notEqual(leg.pct, revGrowthLeg(snap({ ar: [13.04e9, 6.3e9] })).pct, 'the record must change the number it labels');
  // Absence: a stale fingerprint (stored annualRev[0] moved on) is not the record's year.
  const stale = snap({ ar: [14e9, 13.04e9], record: rec });
  assert.equal(revGrowthLeg(stale).basis, 'year');
  sameAsLevel(stale, revGrowthLeg(stale));
  // A quarterly pair always wins over the record, as in revGrowthLevel.
  const q = snap({ rq: [120, 110, 105, 100, 100], ar: [13.04e9, 6.3e9], record: rec });
  assert.equal(revGrowthLeg(q).basis, 'quarter');
  sameAsLevel(q, revGrowthLeg(q));
});
check('A5 no growth figure: none, all null', () => {
  for (const s of [snap({}), snap({ ar: [400, 0] }), snap({ ar: [400] })]) {
    assert.deepEqual(revGrowthLeg(s), { basis: 'none', pct: null, periodEnd: null, priorPeriodEnd: null });
    assert.equal(axes.revGrowthLevel(s), null);
  }
  assert.deepEqual(REV_GROWTH_BASES, ['quarter', 'year', 'yearNewerRecord', 'none']);
});

// ---- (B) the export labels only what it can reproduce --------------------------------
const writeSnap = (dir, s) => fs.writeFileSync(path.join(dir, safeSnapshotFilename(s.meta.ticker)), JSON.stringify(s));
check('B1 presence: the exported number reproduced from its snapshot gets basis and periods', () => {
  const s = snap({ ticker: 'QTR', rq: [120, 110, 105, 100, 100] });
  writeSnap(tmpMain, s);
  const out = W.ergaenzeWachstumsBasis({ ticker: 'QTR', revGrowthYoYPct: axes.revGrowthLevel(prepareSnapshot(s)) });
  assert.deepEqual([out.revGrowthBasis, out.revGrowthPeriodEnd, out.revGrowthPriorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30']);
});
check('B2 absence: a number no snapshot reproduces stays unlabelled and is counted', () => {
  const vorher = W.wachstumOhneEtikett();
  const out = W.ergaenzeWachstumsBasis({ ticker: 'QTR', revGrowthYoYPct: 19.99 });
  assert.deepEqual([out.revGrowthBasis, out.revGrowthPeriodEnd, out.revGrowthPriorPeriodEnd], [null, null, null]);
  const ohne = W.ergaenzeWachstumsBasis({ ticker: 'NOSNAP', revGrowthYoYPct: 5 });
  assert.equal(ohne.revGrowthBasis, null);
  // Both stores carry the ticker, neither reproduces the number: a snapshot alone is no label.
  writeSnap(tmpMain, snap({ ticker: 'BOTH', ar: [300, 100] }));
  writeSnap(tmpSmall, snap({ ticker: 'BOTH', ar: [250, 100] }));
  assert.equal(W.ergaenzeWachstumsBasis({ ticker: 'BOTH', revGrowthYoYPct: 42 }).revGrowthBasis, null);
  assert.equal(W.wachstumOhneEtikett(), vorher + 3);
});
check('B3 small-cap rows are labelled from snapshots-smallcap when the main store does not reproduce them', () => {
  const s = snap({ ticker: 'SMLL', ar: [200, 100], arEnds: ['2025-12-31', '2024-12-31'] });
  writeSnap(tmpSmall, s);
  writeSnap(tmpMain, snap({ ticker: 'SMLL', ar: [300, 100] })); // same ticker, other data
  const out = W.ergaenzeWachstumsBasis({ ticker: 'SMLL', revGrowthYoYPct: 100 });
  assert.deepEqual([out.revGrowthBasis, out.revGrowthPeriodEnd], ['year', '2025-12-31']);
});
check('B4 a row without a number is basis none, whatever its snapshot says', () => {
  const out = W.ergaenzeWachstumsBasis({ ticker: 'QTR', revGrowthYoYPct: null });
  assert.deepEqual([out.revGrowthBasis, out.revGrowthPeriodEnd, out.revGrowthPriorPeriodEnd], ['none', null, null]);
});

// ---- (C) the --check guard, broken on purpose on test rows -----------------------------
const errsOf = (r) => { const e = []; W.checkRevGrowthBasis(r, 'row', e); return e; };
const ok = { revGrowthYoYPct: 12.5, revGrowthBasis: 'quarter', revGrowthPeriodEnd: '2026-06-30', revGrowthPriorPeriodEnd: '2025-06-30' };
check('C1 valid rows and old exports without the fields pass', () => {
  assert.deepEqual(errsOf(ok), []);
  assert.deepEqual(errsOf({ revGrowthYoYPct: 3 }), []);
  assert.deepEqual(errsOf({ revGrowthYoYPct: null, revGrowthBasis: 'none', revGrowthPeriodEnd: null, revGrowthPriorPeriodEnd: null }), []);
  assert.deepEqual(errsOf({ revGrowthYoYPct: 3, revGrowthBasis: null, revGrowthPeriodEnd: null, revGrowthPriorPeriodEnd: null }), []);
  assert.deepEqual(errsOf({ ...ok, revGrowthBasis: 'year', revGrowthPeriodEnd: null, revGrowthPriorPeriodEnd: null }), []);
});
check('C2 each broken row is reported', () => {
  const broken = [
    { ...ok, revGrowthBasis: 'none', revGrowthPeriodEnd: null, revGrowthPriorPeriodEnd: null }, // none with a number
    { ...ok, revGrowthYoYPct: null },                        // a basis without a number
    { ...ok, revGrowthBasis: 'ttm' },                        // unknown basis
    { ...ok, revGrowthPeriodEnd: '2026-06-31' },             // impossible day
    { ...ok, revGrowthPeriodEnd: '2026-06-30T00:00:00Z' },   // not an ISO day
    { ...ok, revGrowthBasis: null },                         // periods on an unlabelled row
    { revGrowthYoYPct: 3, revGrowthBasis: 'year' },          // fields only partly present
  ];
  for (const r of broken) assert.ok(errsOf(r).length > 0, 'not reported: ' + JSON.stringify(r));
});

// ---- (D) the real export -----------------------------------------------------------------
function rowsOf(j) { return Array.isArray(j.rows) ? j.rows : [].concat(j.profitable || [], j.unprofitable || []); }
function exportFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) { if (e.name !== 'druckenmiller' && e.name !== 'smallcap') out.push(...exportFiles(dir, r)); }
    else if (e.name.endsWith('.json') && e.name !== 'index.json') out.push(r);
  }
  return out;
}
if (!fs.existsSync(path.join(realV1, 'overview.json')) || !fs.existsSync(realSnaps)) {
  console.log('SKIP D: no real export on disk (' + realV1 + ') - only (A)-(C) checked');
} else {
  check('D1 every row of the real export: label and number agree with a fresh recomputation', () => {
    const cache = new Map();
    const legOf = (t) => {
      if (!cache.has(t)) {
        let s = null;
        try { s = prepareSnapshot(JSON.parse(fs.readFileSync(path.join(realSnaps, safeSnapshotFilename(t)), 'utf8'))); } catch (_) { s = null; }
        cache.set(t, s ? revGrowthLeg(s) : null);
      }
      return cache.get(t);
    };
    let rows = 0, labelled = 0;
    const bad = [];
    for (const f of exportFiles(realV1)) {
      const r40 = f.startsWith('rule40');
      for (const r of rowsOf(JSON.parse(fs.readFileSync(path.join(realV1, f), 'utf8')))) {
        if (!('revGrowthYoYPct' in r)) continue;
        rows++;
        if (!('revGrowthBasis' in r)) { bad.push(f + ' ' + r.ticker + ': no revGrowthBasis'); continue; }
        if (r.revGrowthYoYPct !== null && r.revGrowthBasis === null) { bad.push(f + ' ' + r.ticker + ': number without label'); continue; }
        if (r.revGrowthBasis === 'none') { if (r.revGrowthYoYPct !== null) bad.push(f + ' ' + r.ticker + ': none with number'); continue; }
        labelled++;
        const leg = legOf(r.ticker);
        const pct = leg && (r40 ? Math.round(leg.pct * 10) / 10 : leg.pct);
        if (!leg || leg.basis !== r.revGrowthBasis || pct !== r.revGrowthYoYPct
            || leg.periodEnd !== r.revGrowthPeriodEnd || leg.priorPeriodEnd !== r.revGrowthPriorPeriodEnd) {
          bad.push(f + ' ' + r.ticker + ': ' + JSON.stringify([r.revGrowthBasis, r.revGrowthYoYPct, r.revGrowthPeriodEnd]) + ' vs ' + JSON.stringify(leg));
        } else if (r40 && r.revGrowthBasis !== 'quarter'
            && r.quartalsEnde !== (leg.periodEnd === null ? null : leg.periodEnd + 'T00:00:00.000Z')) {
          bad.push(f + ' ' + r.ticker + ': quartalsEnde ' + r.quartalsEnde + ' for an annual figure');
        }
      }
    }
    assert.ok(rows > 100, 'the real export has hardly any rows: ' + rows);
    assert.deepEqual(bad.slice(0, 10), [], bad.length + ' rows disagree');
    console.log('       real export: ' + rows + ' rows checked, ' + labelled + ' with a quarter/year basis');
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
