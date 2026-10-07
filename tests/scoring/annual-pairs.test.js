'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const A = require('../../src/scoring/axes.js');
const P = require('../../src/scoring/annual-pairs.js');
const { revGrowthLeg } = require('../../lib/rev-growth-basis.js');
const { rawAxisValue, robustG } = require('../../src/scoring/score.js');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('  ok ' + name); }
const ends = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
const snap = (revenues = [180, 120, 100], dates = ends.slice(0, revenues.length)) => ({
  annual: { annualRev: revenues.map(value => ({ value })), annualRevEnds: dates,
    annualGP: [90, 60, 50], annualGPEnds: ends.slice(0, 3) }, timeseries: {}, meta: {},
});
const date = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const pairSnapshot = (distance, prior = 365) => snap([180, 120, 100], [date(21000), date(21000 - distance), date(21000 - distance - prior)]);
const all = { growth: true, acceleration: true };
const outputs = s => [A.revGrowthLevel(s), A.gpGrowth(s), A.revAcceleration(s), A.revYoYComponents(s), revGrowthLeg(s)];
const abf = () => snap([25756111422.8, 26568807471.6, 26141281700, 26141281700],
  ['2025-08-31', '2024-08-31', '2023-09-30', '2023-08-31']);

check('ABF.L duplicate prior entry preserves annual acceleration without changing the pair', () => {
  const s = abf(), before = JSON.stringify(s);
  assert.deepEqual(P.checkAnnualPair(s, 'annualRev', 1, 2), { code: 'adjacent', distanceDays: 336, priorLengthDays: null });
  const result = P.annualPairsShadow(s).acceleration;
  assert.equal(result.code, 'adjacent');
  assert.ok(Number.isFinite(result.today));
  assert.equal(result.shadow, result.today);
  assert.deepEqual(P.withAnnualPairRule(all, () => outputs(s)), outputs(s));
  assert.equal(JSON.stringify(s), before);
  assert.equal(P.checkAnnualPair(s, 'annualRev', 2, 3).code, 'short-period', 'a duplicate at the selected pair still fails');
});

check('duplicate lookup skips repeated entries but stops at unknown values or dates', () => {
  const s = snap([180, 120, 120, 120, 100], ['2025-12-31', '2024-12-31', '2024-11-30', '2024-10-31', '2023-12-31']);
  assert.deepEqual(P.checkAnnualPair(s, 'annualRev', 0, 1), { code: 'adjacent', distanceDays: 365, priorLengthDays: 366 });
  s.annual.annualRevEnds[4] = null;
  assert.equal(P.checkAnnualPair(s, 'annualRev', 0, 1).priorLengthDays, null);
  s.annual.annualRevEnds[2] = null;
  assert.equal(P.checkAnnualPair(s, 'annualRev', 0, 1).priorLengthDays, null, 'an undated duplicate is not skipped');
  for (const value of [null, NaN, Infinity, 120.0000000001]) {
    const unknown = pairSnapshot(365, 30);
    unknown.annual.annualRev[2] = { value };
    assert.equal(P.checkAnnualPair(unknown, 'annualRev', 0, 1).code, 'short-prior-period', 'only finite exact equality permits skipping');
  }
  const boundary = pairSnapshot(365, 334); boundary.annual.annualRev[2] = { value: 120 };
  assert.equal(P.checkAnnualPair(boundary, 'annualRev', 0, 1).priorLengthDays, 334, '334 days is not a duplicate');
  const chain = snap([180, 120, 120, 120], [date(21000), date(20635), date(20435), date(20235)]);
  assert.equal(P.checkAnnualPair(chain, 'annualRev', 0, 1).priorLengthDays, 400, 'duplicates retain the fixed older anchor');
  const reversed = pairSnapshot(365, -700); reversed.annual.annualRev[2] = { value: 120 };
  assert.equal(P.checkAnnualPair(reversed, 'annualRev', 0, 1).code, 'short-prior-period', 'distant reversed dates are not duplicates');
});

check('different-valued stubs retain their codes including SIG.AX', () => {
  for (const prior of [150, 91, 304, 183, 184]) {
    const s = pairSnapshot(365, prior);
    s.annual.annualRev = [5000000000, 4184504749.76, 3383060818.13];
    assert.equal(P.checkAnnualPair(s, 'annualRev', 0, 1).code, 'short-prior-period', `stub ${prior}`);
    assert.equal(P.annualPairsShadow(s).acceleration.shadow, null);
  }
  assert.equal(P.checkAnnualPair(pairSnapshot(184), 'annualRev', 0, 1).code, 'short-period');
});

check('gross profit and newer-year records use their own normalized stored values', () => {
  const s = pairSnapshot(365, 30);
  s.annual.annualGP = [{ value: 90 }, { value: 60 }, 60];
  s.annual.annualGPEnds = s.annual.annualRevEnds.slice();
  assert.equal(P.checkAnnualPair(s, 'annualGP', 0, 1).code, 'adjacent');
  assert.equal(P.checkAnnualPair(s, 'annualRev', 0, 1).code, 'short-prior-period');
  const record = { end: s.annual.annualRevEnds[0], priorEnd: s.annual.annualRevEnds[1], priorRevenue: 100 };
  assert.equal(P.checkNewerAnnualPair(s, record).code, 'short-prior-period', 'record currency is not the stored value');
  s.annual.annualRev[2] = { value: 120 };
  assert.equal(P.checkNewerAnnualPair(s, record).code, 'adjacent');
  assert.equal(P.checkNewerAnnualPair(s, record).priorLengthDays, null);
});

check('distance boundaries, 52/53-week distance and prior-period boundaries', () => {
  for (const [distance, code] of [[333, 'short-period'], [334, 'adjacent'], [336, 'adjacent'],
    [397, 'adjacent'], [398, 'long-period'], [699, 'long-period'], [700, 'missing-year']]) {
    const actual = P.checkAnnualPair(pairSnapshot(distance), 'annualRev', 0, 1);
    assert.deepEqual(actual, { code, distanceDays: distance, priorLengthDays: 365 }, `distance ${distance}`);
  }
  for (const [prior, code] of [[333, 'short-prior-period'], [334, 'adjacent'], [397, 'adjacent'],
    [398, 'long-prior-period'], [699, 'long-prior-period'], [700, 'adjacent']]) {
    assert.deepEqual(P.checkAnnualPair(pairSnapshot(365, prior), 'annualRev', 0, 1),
      { code, distanceDays: 365, priorLengthDays: prior });
  }
  const weekly = snap([180, 120, 100], ['2025-08-31', '2024-09-29', '2023-09-30']);
  assert.equal(P.checkAnnualPair(weekly, 'annualRev', 0, 1).distanceDays, 336);
  assert.deepEqual(P.withAnnualPairRule(all, () => outputs(weekly)), outputs(weekly));
  assert.equal(P.checkAnnualPair(pairSnapshot(-1), 'annualRev', 0, 1).code, 'short-period');
});

check('undated, invalid ISO days and misaligned arrays pass with identical values', () => {
  for (const dates of [undefined, [], ['2025-12-31'], [null, null, null],
    ['2025-02-30', '2024-02-29', '2023-02-28'], [ends[0], 'bad', ends[2]], [123, ends[1], ends[2]]]) {
    const s = snap(); s.annual.annualRevEnds = dates; s.annual.annualGPEnds = dates;
    assert.equal(P.checkAnnualPair(s, 'annualRev', 0, 1).code, 'undated');
    assert.deepEqual(P.withAnnualPairRule(all, () => outputs(s)), outputs(s));
  }
  const s = snap(); s.annual.annualRevEnds[2] = '2023-02-30';
  assert.deepEqual(P.checkAnnualPair(s, 'annualRev', 0, 1), { code: 'adjacent', distanceDays: 365, priorLengthDays: null });
  s.annual.annualRevEnds = ends.slice(0, 3).map(d => d + 'T12:00:00Z');
  assert.equal(P.checkAnnualPair(s, 'annualRev', 0, 1).code, 'adjacent', 'same timestamp semantics as F-4');
});

check('default off is byte-identical to the original axes code path', () => {
  const file = require.resolve('../../src/scoring/axes.js');
  const module = { exports: {} }, realRequire = createRequire(file);
  const localRequire = id => id === './annual-pairs.js' ? { ...P, annualPairRuleEnabled: () => false } : realRequire(id);
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file })(localRequire, module, module.exports);
  const old = module.exports;
  for (const s of [snap(), pairSnapshot(731), pairSnapshot(304), pairSnapshot(365, 150), snap([180, null, 120, 100])]) {
    for (const fn of ['revGrowthLevel', 'gpGrowth', 'revAcceleration', 'revYoYComponents']) assert.deepEqual(A[fn](s), old[fn](s), fn);
    assert.deepEqual(outputs(s), P.withAnnualPairRule({ growth: false, acceleration: false }, () => outputs(s)));
    assert.equal(revGrowthLeg(s).pct, old.revGrowthLevel(s));
  }
});

check('rejected annual pair stays null without substituting an older healthy pair', () => {
  const s = snap([240, 120, 100, 80], ['2025-12-31', '2023-12-31', '2022-12-31', '2021-12-31']);
  assert.equal(A.revAnnualYoY(s), 1);
  P.withAnnualPairRule(all, () => {
    assert.equal(A.revAnnualYoY(s), null);
    assert.equal(A.revGrowthLevel(s), null);
    assert.deepEqual(A.revYoYComponents(s), []);
    assert.equal(robustG(s), null);
    assert.equal(A.revAcceleration(s), null);
    assert.deepEqual(revGrowthLeg(s), { basis: 'none', pct: null, periodEnd: null, priorPeriodEnd: null, sourcePeriodEnd: null, sourcePriorPeriodEnd: null });
  });
  assert.equal(A.revAnnualYoY(s), 1);
});

check('newer-year record uses its own ends and stored prior length, without replacement', () => {
  const s = snap();
  s.meta.annualRevNewerYear = { end: '2027-12-31', priorEnd: '2025-12-31', revenue: 360, priorRevenue: 180, priorStored: 180 };
  const record = A.annualLegNewerYear(s);
  assert.equal(revGrowthLeg(s).basis, 'yearNewerRecord');
  assert.equal(P.annualPairsShadow(s).growth.code, 'missing-year');
  P.withAnnualPairRule({ growth: true }, () => {
    assert.equal(A.annualLegNewerYear(s), record, 'the validity check itself is unchanged');
    assert.equal(A.revAnnualLegYoY(s), null);
    assert.equal(revGrowthLeg(s).pct, null);
    assert.equal(revGrowthLeg(s).basis, 'none');
    assert.equal(revGrowthLeg(s).periodEnd, null);
  });
  record.end = '2026-12-31';
  s.annual.annualRevEnds = ['2025-12-31', '2025-06-30', '2024-06-30'];
  assert.equal(P.annualPairsShadow(s).growth.code, 'short-prior-period');
  s.annual.annualRevEnds = ['2024-12-31', '2023-12-31', '2022-12-31'];
  assert.equal(P.checkNewerAnnualPair(s, record).priorLengthDays, null, 'no invented index for an absent prior end');
  record.priorEnd = '2025-02-30';
  assert.equal(P.annualPairsShadow(s).growth.code, 'undated');
  assert.equal(P.withAnnualPairRule(all, () => revGrowthLeg(s).pct), 100);
});

check('gross profit judges its own pair only, not the margin trajectory', () => {
  const s = snap(); s.annual.annualGPEnds = ['2025-12-31', '2023-12-31', '2022-12-31'];
  assert.equal(P.withAnnualPairRule({ growth: true }, () => A.gpGrowth(s)), null);
  assert.equal(P.withAnnualPairRule({ acceleration: true }, () => A.gpGrowth(s)), A.gpGrowth(s));
  s.annual.annualGPEnds = ends.slice(0, 3);
  s.annual.annualRevEnds = ['2025-12-31', '2023-12-31', '2022-12-31'];
  assert.equal(P.withAnnualPairRule(all, () => A.gpGrowth(s)), A.gpGrowth(s), 'GM endpoints are not an annual pair rate');
});

check('parts a and b are independent, rawAxisValue uses null without score plumbing', () => {
  const s = pairSnapshot(731); s.annual.annualGPEnds = s.annual.annualRevEnds;
  P.withAnnualPairRule({ growth: true }, () => {
    assert.equal(A.revGrowthLevel(s), null); assert.equal(A.gpGrowth(s), null);
    assert.equal(A.revAcceleration(s), 0.30000000000000004);
    assert.equal(rawAxisValue(s, 'gpGrowth', {}, 'profitable'), null);
  });
  P.withAnnualPairRule({ acceleration: true }, () => {
    assert.equal(A.revGrowthLevel(s), 50); assert.equal(A.gpGrowth(s), 0.5);
    assert.equal(A.revAcceleration(s), null);
    assert.equal(rawAxisValue(s, 'revAcceleration', {}, 'profitable'), null);
  });
});

check('ASTS-like zero year is reported data, negative year likewise, never a gap', () => {
  for (const zero of [0, -1]) {
    const s = snap([70918000, 4418000, zero, 13825000]);
    assert.ok(Number.isFinite(A.revAcceleration(s)));
    const result = P.annualPairsShadow(s).acceleration;
    assert.equal(result.code, 'zero-year'); assert.equal(result.shadow, null);
    assert.match(result.reason, new RegExp('Umsatz 2023 war ' + zero));
    assert.match(result.reason, /gemeldeter Wert, keine Datenlücke/);
    s.annual.annualRevEnds = undefined;
    assert.equal(P.annualPairsShadow(s).acceleration.code, 'zero-year', 'zero verdict is independent of dates');
  }
  const withNull = snap([200, 100, 0, null, 80], undefined);
  withNull.annual.annualRevEnds = undefined;
  assert.notEqual(P.annualPairsShadow(withNull).acceleration.code, 'zero-year');
  assert.equal(P.withAnnualPairRule(all, () => A.revAcceleration(withNull)), A.revAcceleration(withNull));
  withNull.annual.annualRevEnds = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31', '2021-12-31'];
  assert.equal(P.annualPairsShadow(withNull).acceleration.code, 'missing-year');
});

check('acceleration uses first three positive values and first failure in pair order', () => {
  const s = snap([null, 180, 120, 100], [null, ...ends.slice(0, 3)]);
  assert.equal(P.annualPairsShadow(s).acceleration.code, 'adjacent');
  assert.equal(P.withAnnualPairRule(all, () => A.revAcceleration(s)), A.revAcceleration(s));
  s.annual.annualRevEnds = [null, '2025-12-31', '2023-12-31', '2023-06-30'];
  assert.equal(P.annualPairsShadow(s).acceleration.code, 'missing-year');
  const second = pairSnapshot(365, 731);
  assert.equal(P.checkAnnualPair(second, 'annualRev', 0, 1).code, 'adjacent');
  assert.equal(P.annualPairsShadow(second).acceleration.code, 'missing-year');
  assert.equal(P.annualPairsShadow(second).acceleration.distanceDays, 731);
});

check('quarterly display and quarterly acceleration remain unchanged; bonus annual leg is judged', () => {
  const s = pairSnapshot(731);
  s.timeseries.revenueQ = [60, 50, 40, 35, 30, 25]; // two quarterly YoY pairs
  const before = A.revAcceleration(s, [-0.5, 0.8]);
  const sh = P.annualPairsShadow(s, [-0.5, 0.8]);
  assert.equal(sh.growth.code, 'missing-year');
  assert.equal(sh.growth.today, 100); assert.equal(sh.growth.shadow, 100);
  assert.equal(sh.acceleration.code, 'no-annual-pair');
  assert.equal(sh.acceleration.today, before); assert.equal(sh.acceleration.shadow, before);
  assert.deepEqual(P.withAnnualPairRule(all, () => A.revYoYComponents(s)), [1]);
  s.meta.annualRevNewerYear = { end: '2026-12-31', priorEnd: '2025-12-31', revenue: 360, priorRevenue: 180, priorStored: 180 };
  assert.equal(P.annualPairsShadow(s).growth.code, 'missing-year', 'quarter display ignores the newer record like robustG');
});

check('all verdicts carry German reasons, raw values, dates and no fake zero', () => {
  for (const [distance, prior, code] of [[365,365,'adjacent'], [731,365,'missing-year'], [456,365,'long-period'],
    [304,365,'short-period'], [365,150,'short-prior-period'], [365,456,'long-prior-period']]) {
    const s = pairSnapshot(distance, prior), sh = P.annualPairsShadow(s, [-0.1, 0.1]);
    assert.equal(sh.growth.code, code);
    assert.match(sh.growth.reason, /Geschäftsjahr|Vorjahr/);
    assert.match(sh.growth.reason, /Monate/);
    assert.equal(sh.growth.today, revGrowthLeg(s).pct);
    assert.equal(sh.grossProfit.today, A.gpGrowth(s));
    assert.equal(sh.acceleration.today, A.revAcceleration(s, [-0.1, 0.1]));
    assert.ok(!/[–—]/.test(sh.growth.reason));
  }
  const noPair = P.annualPairsShadow(snap([180, null, 100]));
  assert.equal(noPair.growth.code, 'no-annual-pair'); assert.equal(noPair.growth.today, null);
  assert.equal(noPair.acceleration.code, 'no-annual-pair');
  for (const code of ['no-snapshot', 'snapshot-unreadable']) {
    for (const axis of ['growth', 'grossProfit', 'acceleration']) {
      assert.equal(P.annualPairsShadow(null, null, code)[axis].code, code);
      assert.equal(P.annualPairsShadow(null, null, code)[axis].today, null);
      assert.equal(P.annualPairsShadow(null, null, code)[axis].shadow, null);
    }
  }
});

check('restore after throw, nested overrides, thenable and throwing then getter', () => {
  const s = pairSnapshot(731), before = JSON.stringify(s);
  assert.throws(() => P.withAnnualPairRule(all, () => { throw new Error('probe'); }), /probe/);
  assert.equal(P.annualPairRuleEnabled('growth'), false);
  P.withAnnualPairRule({ growth: true }, () => {
    assert.equal(A.revGrowthLevel(s), null);
    P.withAnnualPairRule({ growth: false, acceleration: true }, () => {
      assert.equal(A.revGrowthLevel(s), 50); assert.equal(A.revAcceleration(s), null);
    });
    assert.equal(A.revGrowthLevel(s), null); assert.ok(Number.isFinite(A.revAcceleration(s)));
    const shadow = P.annualPairsShadow(s);
    assert.equal(shadow.growth.today, 50); assert.equal(shadow.growth.shadow, null);
    assert.equal(P.annualPairRuleEnabled('growth'), true);
  });
  for (const result of [Promise.resolve(1), { then() {} }, { get then() {
    assert.equal(P.annualPairRuleEnabled('growth'), false, 'state restored before accessing then');
    throw new TypeError('then getter');
  } }]) assert.throws(() => P.withAnnualPairRule(all, () => result), TypeError);
  assert.equal(P.annualPairRuleEnabled('growth'), false);
  assert.equal(P.annualPairRuleEnabled('acceleration'), false);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => P.withAnnualPairRule({ growth: 'true' }, () => 1), TypeError);
});

check('break-once: raising the minimum to 335 makes the real 334-day assertion red', () => {
  const file = require.resolve('../../src/scoring/annual-pairs.js');
  const digest = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = digest(), source = fs.readFileSync(file, 'utf8');
  const anchor = 'const ANNUAL_PAIR_MIN_DAYS = 334;';
  assert.equal(source.split(anchor).length, 2, 'whole-line mutation anchor occurs exactly once');
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + source.replace(anchor, 'const ANNUAL_PAIR_MIN_DAYS = 335;') + '\n})',
    { filename: file + '.synthetic-mutant' })(createRequire(file), module, module.exports);
  const probe = api => assert.equal(api.checkAnnualPair(pairSnapshot(334), 'annualRev', 0, 1).code, 'adjacent', '334 days must pass');
  assert.throws(() => probe(module.exports), error => {
    assert.equal(error.code, 'ERR_ASSERTION');
    console.log('BREAK-ONCE ERR_ASSERTION: 334 days must pass; actual short-period, expected adjacent');
    return true;
  });
  probe(P);
  assert.equal(digest(), before, 'live source never changed; discarded in-memory mutant only');
});

check('break-once: disabling duplicate skipping makes the ABF.L assertion red in memory', () => {
  const file = require.resolve('../../src/scoring/annual-pairs.js');
  const digest = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = digest(), source = fs.readFileSync(file, 'utf8');
  const anchor = '  while (Number.isFinite(values[index]) && values[next] === values[index] && older !== null) {';
  assert.equal(source.split(/\r?\n/).filter(line => line === anchor).length, 1, 'whole-line mutation anchor occurs exactly once');
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + source.replace(anchor, '  while (false) {') + '\n})',
    { filename: file + '.duplicate-mutant' })(createRequire(file), module, module.exports);
  const probe = api => assert.equal(api.checkAnnualAcceleration(abf()).code, 'adjacent', 'ABF.L duplicate must preserve acceleration');
  assert.throws(() => probe(module.exports), error => {
    assert.equal(error.code, 'ERR_ASSERTION');
    console.log(`BREAK-ONCE ERR_ASSERTION: ABF.L duplicate must preserve acceleration; actual ${error.actual}, expected ${error.expected}`);
    return true;
  });
  probe(P);
  assert.equal(digest(), before, 'live source never changed; discarded in-memory mutant only');
});

console.log(`annual-pairs.test.js: ${passed} ok, 0 fail`);
