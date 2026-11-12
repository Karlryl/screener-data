'use strict';
// Codex R2 on PR 85 (12.11.2026): the counter-probes of the verdict as permanent tests. Every case must give the same answer
// in both input orders, and every contradiction must leave the period open (no fill) instead of choosing a figure.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const P = require('../lib/sec-pit.js'), X = require('../lib/exchange-quarter-check.js'), S = require('../lib/exchange-quarter-store.js');
const { main } = require('../scripts/fetch-exchange-quarters.js');

const f = (start, end, val, filed, form = '10-Q', accn = 'test') => ({ start, end, val, filed, form, accn });
const group = (qs) => Object.fromEntries(qs.map(({ end, ...q }) => [end, [{ ...q, confirmedBy: [] }]]));
const store = (qs) => ({ schemaVersion: 1, market: 'US', currency: 'USD', unit: 1, sources: {}, companies: { REVIEWX: { cik: '0000000001', Revenues: group(qs) } } });
const snapshot = (ends = ['2026-03-31', '2025-12-31'], vals = [100, 100], asOf = '2026-11-11') => ({
  meta: { ticker: 'REVIEWX', country: 'United States', reportingCurrency: 'USD', asOf: asOf + 'T09:00:00Z', fetchedAt: asOf + 'T09:00:00Z' },
  timeseries: { revenueQ: vals.map((value) => ({ value })), revenueQEnds: ends }, annual: {}, metrics: {}, marketCap: {} });
const run = (s, st) => X.applyExchangeCheck(s, { mode: 'fill-only', usFill: true, context: { stores: { us: st }, baseline: { rows: new Map() } } }).result || {};
const fillOf = (s, facts) => run(s, store(P.pitSingleQuarters(facts))).fill?.current ?? null;
const hist = [f('2026-01-01', '2026-03-31', 100, '2026-05-01'), f('2025-10-01', '2025-12-31', 100, '2026-02-01', '10-K'), f('2025-04-01', '2025-06-30', 100, '2025-08-01')];
const direct = f('2026-04-01', '2026-06-30', 150, '2026-08-01');
const both = (xs) => [xs, [...xs].reverse()];

test('premise: the plain case still fills (150 against 100)', () => assert.equal(fillOf(snapshot(), [...hist, direct]), 150));

test('sameDayYtdWithDirect: two half-year figures of one day (250, 350) next to a reported Q2 never fill, in either order', () => {
  for (const day of ['2026-08-01', '2026-09-01']) {
    for (const ys of both([f('2026-01-01', '2026-06-30', 250, day), f('2026-01-01', '2026-06-30', 350, day, '10-Q/A')])) {
      assert.equal(fillOf(snapshot(), [...hist, direct, ...ys]), null, day);
    }
  }
});

test('sameDayAnnualWithDirect and earlyQuarterAmendment: contradicting annual sums or an amended first quarter open the fourth quarter', () => {
  const yr = [f('2024-07-01', '2024-09-30', 100, '2024-11-01'), f('2024-10-01', '2024-12-31', 100, '2025-02-01', '10-K'), f('2025-01-01', '2025-03-31', 100, '2025-05-01'),
    f('2025-04-01', '2025-06-30', 100, '2025-08-01'), f('2025-07-01', '2025-09-30', 100, '2025-11-01'),
    f('2025-10-01', '2025-12-31', 100, '2026-02-01', '10-K'), f('2025-01-01', '2025-12-31', 400, '2026-02-01', '10-K')];
  const sy = snapshot(['2025-09-30', '2024-09-30'], [100, 100], '2026-04-02');
  assert.equal(fillOf(sy, yr), 100, 'consistent year fills');
  for (const ya of both([f('2025-01-01', '2025-12-31', 400, '2026-03-01', '10-K/A'), f('2025-01-01', '2025-12-31', 550, '2026-03-01', '10-K/A')])) {
    assert.equal(fillOf(sy, [...yr, ...ya]), null);
  }
  assert.equal(fillOf(sy, [...yr, f('2025-01-01', '2025-06-30', 200, '2025-08-01'), f('2025-01-01', '2025-03-31', 200, '2026-03-01', '10-Q/A')]), null);
});

test('sameEndDifferentStart and sameDayNearThreshold: the verdict does not depend on the order', () => {
  for (const facts of both([direct, { ...direct, start: '2026-04-02', val: 250 }])) assert.equal(fillOf(snapshot(), [...hist, ...facts]), null);
  const near = both([{ ...direct, val: 100 }, { ...direct, val: 100.501 }]).map((facts) => fillOf(snapshot(), [...hist, ...facts]));
  assert.equal(near[0], near[1]);
});

test('readerOrdering: the stored reader gives the same answer in both orders', () => {
  const obs = (val) => ({ ...direct, days: 90, derivation: 'reported-3M', val });
  const read = (vals) => X.secQuartersKnown({ Revenues: { '2026-06-30': vals.map(obs) } }, 'Revenues', '2026-11-11')[0];
  for (const pair of [[150, 150], [150, 250], [100, 100.501]]) {
    const [a, b] = both(pair).map(read);
    assert.equal(a.derivation, b.derivation, pair.join('/'));
  }
  assert.equal(read([150, 250]).derivation, 'restatement-conflict');
});

test('missingDataDay: a snapshot without asOf and fetchedAt never fills', () => {
  const undated = snapshot(); delete undated.meta.asOf; delete undated.meta.fetchedAt;
  const r = run(undated, store(P.pitSingleQuarters([...hist, { ...direct, filed: '2027-08-01' }])));
  assert.equal(r.fill ?? null, null);
});

test('after2027: a Friday filing of 14.01.2028 is unknown on Martin Luther King Jr. Day 17.01.2028 and known on 18.01.', () => {
  const facts = [f('2027-10-01', '2027-12-31', 200, '2028-01-14', '10-K'), f('2026-10-01', '2026-12-31', 100, '2027-02-01', '10-K'),
    f('2027-07-01', '2027-09-30', 100, '2027-11-01'), f('2027-04-01', '2027-06-30', 100, '2027-08-01')];
  assert.equal(fillOf(snapshot(['2027-09-30', '2027-06-30'], [100, 100], '2028-01-17'), facts), null);
  assert.equal(fillOf(snapshot(['2027-09-30', '2027-06-30'], [100, 100], '2028-01-18'), facts), 200);
  assert.equal(P.effectiveDay('2027-12-30'), '2027-12-31', 'New Year 2028 is a Saturday and is not moved to the Friday before');
});

test('differentFirmAlias: another issuer seated abroad with three matching quarters does not take the US entry', () => {
  const s = snapshot(['2026-03-31', '2025-12-31', '2025-09-30'], [100, 110, 120]);
  s.meta = { ...s.meta, ticker: 'UNRELATED.TO', country: 'Canada', name: 'Unrelated Issuer' };
  const st = store(P.pitSingleQuarters([direct, f('2026-01-01', '2026-03-31', 100, '2026-05-01'), f('2025-10-01', '2025-12-31', 110, '2026-02-01', '10-K'),
    f('2025-07-01', '2025-09-30', 120, '2025-11-01'), f('2025-04-01', '2025-06-30', 100, '2025-08-01')]));
  assert.equal(run(s, st).fill ?? null, null);
});

test('storedDerivedRevocation: a later amendment revokes a derived fourth quarter already in the append-only store', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-r2-')), snaps = path.join(dir, 'snaps');
  fs.mkdirSync(snaps);
  const s = snapshot(['2025-09-30', '2025-06-30', '2025-03-31', '2024-12-31', '2024-09-30'], [100, 100, 100, 100, 100], '2026-04-02');
  s.meta.mostRecentQuarter = '2025-12-31';
  fs.writeFileSync(path.join(snaps, 'REVIEWX.json'), JSON.stringify(s));
  const year = [f('2024-07-01', '2024-09-30', 100, '2024-11-01'), f('2024-10-01', '2024-12-31', 100, '2025-02-01', '10-K'), f('2025-01-01', '2025-03-31', 100, '2025-05-01'),
    f('2025-04-01', '2025-06-30', 100, '2025-08-01'), f('2025-07-01', '2025-09-30', 100, '2025-11-01'), f('2025-01-01', '2025-12-31', 400, '2026-02-01', '10-K')];
  // The store as an earlier run wrote it: Q4 = 400 - 3 x 100 derived, filed with the 10-K.
  const seed = store(P.pitSingleQuarters(year));
  assert.equal(seed.companies.REVIEWX.Revenues['2025-12-31'][0].derivation, 'year-minus-three-quarters');
  fs.writeFileSync(path.join(dir, 'us.json'), JSON.stringify(seed));
  assert.equal(run(s, seed).fill?.current, 100, 'before: the derived Q4 fills');
  const amended = [...year, f('2025-01-01', '2025-06-30', 200, '2025-08-01'), f('2025-01-01', '2025-06-30', 300, '2026-03-01', '10-Q/A')];
  const r = await main({ markets: ['us'], dir, tickers: [], priority: new Map(), usBoard: new Set(['REVIEWX']), snapshotDirs: [snaps], cikMap: {},
    secTickers: async () => ({ REVIEWX: { cik: '0000000001' } }), secFacts: async () => ({ facts: { 'us-gaap': { Revenues: { units: { USD: amended } } } } }),
    log: () => {}, now: () => new Date('2026-04-02T09:00:00Z') });
  assert.equal(r.exitCode, 0);
  const next = JSON.parse(fs.readFileSync(path.join(dir, 'us.json'), 'utf8'));
  S.assertAppendOnly(seed, next);
  assert.ok(next.companies.REVIEWX.Revenues['2025-12-31'].some((o) => o.derivation === 'restatement-conflict'), 'a conflict marker was appended');
  assert.equal(run(s, next).fill ?? null, null, 'after: the old derived Q4 no longer fills');
});

test('reserve: the off-board share goes to a firm SEC can be asked about, not to one without a CIK; the warning counts the real calls', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-r2q-')), snaps = path.join(dir, 'snaps');
  fs.mkdirSync(snaps);
  for (const t of ['BOARDA', 'BOARDB', 'ANOCIK', 'CALLME']) {
    const s = snapshot(['2026-06-30', '2026-03-31'], [100, 100], '2026-11-02'); s.meta.ticker = t; s.meta.mostRecentQuarter = '2026-06-30';
    fs.writeFileSync(path.join(snaps, t + '.json'), JSON.stringify(s));
  }
  const asked = [], lines = [];
  await main({ markets: ['us'], dir, tickers: [], priority: new Map(), usBoard: new Set(['BOARDA', 'BOARDB']), snapshotDirs: [snaps], cikMap: {}, secCap: 2,
    secTickers: async () => ({ BOARDA: { cik: '0000000011' }, BOARDB: { cik: '0000000012' }, CALLME: { cik: '0000000013' } }),
    secFacts: async (c) => { asked.push(c); return null; }, log: (m) => lines.push(m), now: () => new Date('2026-11-02T13:47:00Z') });
  assert.deepEqual(asked, ['0000000011', '0000000013'], 'one board call, the reserved call to CALLME (ANOCIK has no CIK)');
  assert.match(lines.join(' '), /1 of 2 calls went to firms off the boards/);
});

// Codex R3 on PR 85: all permutations, whole-set comparison, open operands in every derivation, impossible data days.
const perms = (a) => (a.length < 2 ? [a] : a.flatMap((x, i) => perms(a.filter((_, j) => j !== i)).map((p) => [x, ...p])));
const d100 = f('2026-04-01', '2026-06-30', 100, '2026-08-01');
const fillsAll = (sets, s = snapshot()) => sets.map((xs) => fillOf(s, [...hist, ...xs]));

test('samePeriodThreeFigures: 100, 99.6 and 100.4 of one period (99.6 to 100.4 is 0.8 %) never fill, in all six orders', () => {
  assert.deepEqual(fillsAll(perms([{ ...d100, accn: 'a' }, { ...d100, accn: 'b', val: 99.6 }, { ...d100, accn: 'c', val: 100.4 }])), Array(6).fill(null));
});
test('sameEndThreeStarts and sameEndNearThreshold: start days up to three apart are one period; every order gives the same answer', () => {
  assert.deepEqual(fillsAll(perms([d100, { ...d100, start: '2026-04-02', val: 99.6 }, { ...d100, start: '2026-04-03', val: 100.4 }])), Array(6).fill(null));
  const near = fillsAll(perms([d100, { ...d100, start: '2026-04-02', val: 100.501 }]));
  assert.equal(new Set(near.map(String)).size, 1, near.join('/'));
});
test('openOperandPropagation: a first quarter in conflict (100 and 200) is no operand of the half year either, in both orders', () => {
  const facts = [...hist, f('2025-07-01', '2025-09-30', 100, '2025-11-01'), f('2026-01-02', '2026-03-31', 200, '2026-05-01'), f('2026-01-01', '2026-06-30', 250, '2026-08-01')];
  const s = snapshot(['2026-03-31', '2025-12-31', '2025-09-30'], [100, 100, 100]);
  for (const xs of both(facts)) {
    assert.equal(P.pitSingleQuarters(xs).find((q) => q.end === '2026-06-30')?.derivation ?? 'restatement-conflict', 'restatement-conflict');
    assert.equal(fillOf(s, xs), null);
  }
});
test('normal cases still fill: the same figure again in the 10-K, and the same figure with a start one day later', () => {
  assert.equal(fillOf(snapshot(), [...hist, d100, { ...d100, filed: '2027-02-10', form: '10-K' }]), 100);
  assert.equal(fillOf(snapshot(), [...hist, d100, { ...d100, start: '2026-04-02', filed: '2026-11-05', form: '10-K' }]), 100);
});
test('invalidDataDays: an impossible data day (2026-99-99, 2026-02-30) holds like a missing one', () => {
  for (const day of ['2026-99-99', '2026-02-30']) {
    const s = snapshot(); s.meta.asOf = day; s.meta.fetchedAt = day;
    assert.equal(run(s, store(P.pitSingleQuarters([...hist, d100]))).fill ?? null, null, day);
  }
});
test('a different CIK: no link to a listing that names another CIK', () => {
  const st = store(P.pitSingleQuarters([...hist, d100]));
  const other = snapshot(['2026-03-31', '2025-12-31', '2025-06-30'], [100, 100, 100]);
  other.meta = { ...other.meta, ticker: 'UNRELATED.TO', cik: '0000000999' };
  assert.equal(X.evaluateUs(other, st), null);
  const same = snapshot(); same.meta.cik = '1';
  assert.equal(X.evaluateUs(same, st)?.category, 'sec-fill', 'the same CIK, written without leading zeros, still fills');
});
test('isolated: a half year reported twice with start days one apart (250 and 350) opens Q2 even though no first-quarter start matches the second', () => {
  // Only the grouping of close start days into one period catches this: H1 from 02.01. pairs with no quarter, so without it
  // the two remaining ways (reported 150, 250 - 100) agree and 150 would fill against the contradicting 350.
  const facts = [...hist, d100, { ...d100, val: 150 }].filter((x) => x.val !== 100 || x.end !== '2026-06-30');
  const xs = [...hist, { ...d100, val: 150 }, f('2026-01-01', '2026-06-30', 250, '2026-08-01'), f('2026-01-02', '2026-06-30', 350, '2026-08-01')];
  for (const order of both(xs)) assert.equal(fillOf(snapshot(), order), null);
  assert.ok(facts.length > 0);
});
test('isolated: a first quarter open because two quarter-long reports disagree (start 01.01. 100, start 10.01. 200) is no operand of the half year', () => {
  // Starts nine days apart are two periods, neither contested on its own; only the open end of the quarter stops 250 - 100.
  const xs = [...hist.filter((x) => x.end !== '2026-03-31'), f('2026-01-01', '2026-03-31', 100, '2026-05-01'), f('2026-01-10', '2026-03-31', 200, '2026-05-01'),
    f('2026-01-01', '2026-06-30', 250, '2026-08-01')];
  for (const order of both(xs)) {
    assert.equal(fillOf(snapshot(), order), null);
    assert.equal(P.pitSingleQuarters(order).find((q) => q.end === '2026-06-30').derivation, 'restatement-conflict', 'Q2 itself is open, not just unused');
  }
});
test('blind delta check M1: a third agreeing half year from 29.12. does not hide the contradicting 350 (no fill, any order)', () => {
  const xs = [...hist, { ...d100, val: 150 }, f('2026-01-01', '2026-06-30', 250, '2026-08-01'), f('2026-01-02', '2026-06-30', 350, '2026-08-01'),
    f('2025-12-29', '2026-06-30', 250, '2026-08-01')];
  assert.deepEqual([...new Set(perms(xs.slice(-4)).map((t) => String(fillOf(snapshot(), [...hist, ...t]))))], ['null']);
});
test('blind delta check M2: the same quarter with end days one apart (29.06. 150, 30.06. 200) leaves both open, in both orders', () => {
  const xs = [f('2026-04-01', '2026-06-29', 150, '2026-08-01'), f('2026-04-01', '2026-06-30', 200, '2026-08-01')];
  for (const order of both(xs)) {
    const q = P.pitSingleQuarters([...hist, ...order]);
    assert.deepEqual(['2026-06-29', '2026-06-30'].map((e) => q.find((x) => x.end === e)?.derivation), ['restatement-conflict', 'restatement-conflict']);
    assert.equal(fillOf(snapshot(), [...hist, ...order]), null);
  }
});
test('blind delta check N1 (master 12.11.): a year restated by 0.47 % opens the derived fourth quarter; 0.0125 % is the same figure', () => {
  const year = (val, filed = '2026-02-01') => f('2025-01-01', '2025-12-31', val, filed, '10-K');
  const qs = [f('2025-01-01', '2025-03-31', 100, '2025-05-01'), f('2025-04-01', '2025-06-30', 100, '2025-08-01'), f('2025-07-01', '2025-09-30', 100, '2025-11-01')];
  const q4 = (xs) => P.pitSingleQuarters(xs).find((q) => q.end === '2025-12-31');
  assert.deepEqual([q4([...qs, year(400)]).val, q4([...qs, year(400)]).derivation], [100, 'year-minus-three-quarters']);
  assert.equal(q4([...qs, year(400), year(401.9, '2026-03-01')]).derivation, 'restatement-conflict', '0.47 % was equal under 0.5 % and moved Q4 by 1.9 %');
  assert.equal(q4([...qs, year(400), year(400.05, '2026-03-01')]).derivation, 'year-minus-three-quarters', '0.0125 % stays the same figure');
});

test('Codex R4 P1-A: a later amendment of an operand dates the marker, so a stored derived quarter turns open from then on (not before)', async () => {
  const facts = [f('2026-01-01', '2026-03-31', 100, '2026-05-01'), f('2026-01-01', '2026-03-31', 100, '2026-09-01', '10-Q', 'repeat-q1'),
    f('2026-01-01', '2026-06-30', 250, '2026-08-01'), f('2025-10-01', '2025-12-31', 100, '2026-02-01', '10-K'),
    f('2025-07-01', '2025-09-30', 100, '2025-11-01'), f('2025-04-01', '2025-06-30', 100, '2025-08-01')];
  const amendment = f('2026-01-10', '2026-03-31', 200, '2026-09-15', '10-Q/A', 'late-q1');
  const fresh = P.pitSingleQuarters([...facts, amendment]).find((q) => q.end === '2026-06-30');
  assert.deepEqual([fresh.derivation, fresh.filed], ['restatement-conflict', '2026-09-15']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-r4-')), snaps = path.join(dir, 'snaps');
  fs.mkdirSync(snaps);
  const s = snapshot(['2026-03-31', '2025-12-31', '2025-09-30'], [100, 100, 100]);
  s.meta.mostRecentQuarter = '2026-06-30';
  fs.writeFileSync(path.join(snaps, 'REVIEWX.json'), JSON.stringify(s));
  // The store as an earlier run wrote it before the amendment: Q2 = 250 - 100, filed 01.08.
  const seed = store(P.pitSingleQuarters(facts));
  assert.equal(run(s, seed).fill?.current, 150, 'before: the derived Q2 fills');
  fs.writeFileSync(path.join(dir, 'us.json'), JSON.stringify(seed));
  let prev = seed;
  for (const day of ['2026-11-11', '2026-11-12']) {
    const r = await main({ markets: ['us'], dir, tickers: [], priority: new Map(), usBoard: new Set(['REVIEWX']), snapshotDirs: [snaps], cikMap: {},
      secTickers: async () => ({ REVIEWX: { cik: '0000000001' } }), secFacts: async () => ({ facts: { 'us-gaap': { Revenues: { units: { USD: [...facts, amendment] } } } } }),
      log: () => {}, now: () => new Date(day + 'T09:00:00Z') });
    assert.equal(r.exitCode, 0);
    const next = JSON.parse(fs.readFileSync(path.join(dir, 'us.json'), 'utf8'));
    S.assertAppendOnly(prev, next); prev = next;
    assert.equal(run(s, next).fill ?? null, null, day + ': the amended operand keeps Q2 open');
  }
  const before = X.secQuartersKnown(prev.companies.REVIEWX, 'Revenues', '2026-09-14').find((q) => q.end === '2026-06-30');
  assert.equal(before?.val, 150, 'a reader before the amendment still sees the figure known then');
});

test('Codex R4 P1-B: alternative cumulative figures are compared after subtraction (250/251 minus 100; a year 400/400.8/401.6), in every order', () => {
  const h1 = [f('2026-01-01', '2026-03-31', 100, '2026-05-01'), f('2026-01-02', '2026-03-31', 100, '2026-05-01'), f('2026-01-01', '2026-06-30', 250, '2026-08-01'), f('2026-01-02', '2026-06-30', 251, '2026-08-01')];
  for (const xs of perms(h1)) assert.equal(P.pitSingleQuarters(xs).find((q) => q.end === '2026-06-30').derivation, 'restatement-conflict');
  const quarters = [f('2025-01-01', '2025-03-31', 100, '2025-05-01'), f('2025-04-01', '2025-06-30', 100, '2025-08-01'), f('2025-07-01', '2025-09-30', 100, '2025-11-01')];
  const years = [400, 400.8, 401.6].map((v, i) => f('2025-01-0' + (1 + i), '2025-12-31', v, '2026-02-01', '10-K', 'y' + i));
  for (const xs of perms([...quarters, ...years])) assert.equal(P.pitSingleQuarters(xs).find((q) => q.end === '2025-12-31').derivation, 'restatement-conflict');
});

test('Codex R4 P2-D: a data day that is no plain day string (an array, a day with trailing text) holds; the derivation knows nothing on such a day', () => {
  for (const day of [['2026-11-11'], '2026-11-11garbage', 20261111]) {
    const s = snapshot(); s.meta.asOf = day; s.meta.fetchedAt = day;
    assert.equal(run(s, store(P.pitSingleQuarters([...hist, direct]))).fill ?? null, null, JSON.stringify(day));
    assert.deepEqual(P.pitSingleQuarters([...hist, direct], { asOf: day }), [], JSON.stringify(day));
  }
  assert.equal(P.pitSingleQuarters([...hist, direct], { asOf: '2026-11-11' }).length > 0, true);
});

test('blind delta check F1 (12.11. evening): marker day and conflictsWith are the same in every input order', () => {
  const a = [f('2026-01-01', '2026-03-31', 100, '2026-05-01'), f('2026-01-01', '2026-06-30', 250, '2026-08-01'),
    f('2026-01-02', '2026-06-30', 251, '2026-09-15', '10-Q/A', 'g1'), f('2026-01-02', '2026-06-30', 251, '2027-08-01', '10-Q', 'g2')];
  const resA = new Set(perms(a).map((xs) => JSON.stringify(P.pitSingleQuarters(xs).find((q) => q.end === '2026-06-30'))));
  assert.equal(resA.size, 1, [...resA].join('\n'));
  const b = [f('2026-04-01', '2026-06-30', 150, '2026-08-01'), f('2026-04-01', '2026-06-30', 151, '2026-09-15', '10-Q/A', 'b1')];
  const resB = perms(b).map((xs) => P.pitSingleQuarters(xs)[0]);
  assert.equal(new Set(resB.map((x) => JSON.stringify(x))).size, 1);
  assert.deepEqual([resB[0].derivation, resB[0].val, resB[0].filed, resB[0].conflictsWith.val], ['restatement-conflict', 150, '2026-09-15', 151], 'conflictsWith names the other figure');
});

test('blind delta check F4: two figures of one filing day count as the same only within 0.02 % when the store is read', () => {
  const obs = (val, accn) => ({ start: '2026-04-01', val, filed: '2026-08-01', form: '10-Q', accn, days: 90, derivation: 'reported-3M', confirmedBy: [] });
  const company = (v2) => ({ cik: '0000000001', Revenues: { '2026-06-30': [obs(150, 'a'), obs(v2, 'b')] } });
  const read = (v2) => X.secQuartersKnown(company(v2), 'Revenues', '2026-11-11').find((q) => q.end === '2026-06-30');
  assert.deepEqual([read(150.02).derivation, read(150.02).val], ['reported-3M', 150], '0.013 % apart: one figure');
  assert.equal(read(150.3).derivation, 'restatement-conflict', '0.2 % apart: the day is split, the period stays open');
});
