'use strict';
// Tag 1407 (Codex after-the-fact review of #401, 03.10.2026, P1): the stale reload selects
// annual-only reporters whose stored annual series carry no period ends. historyIsThinner()
// compared dated periods only, so a successful but empty or shorter Yahoo answer replaced the
// stored values (annualRev [182, 95] -> []). Raw data is never overwritten (G24): such a reload
// must count as thinner, so pullAll() keeps the stored snapshot. Pure function, writes nothing.
const assert = require('node:assert/strict');
const { historyIsThinner } = require('../lib/reload-history.js');

const annual = (rev, extra = {}) => ({ annualRev: rev, annualOpInc: rev.map(v => v == null ? null : v / 10),
  annualNetIncome: rev.map(v => v == null ? null : v / 20), annualFCF: rev.map(v => v == null ? null : v / 30), ...extra });
const snap = (a, timeseries = {}) => ({ annual: a, timeseries, meta: {} });
const prior = snap(annual([182, 95]));

// 1) Codex reproduction: an empty answer over undated history.
assert.equal(historyIsThinner(snap(annual([])), prior), true, 'empty answer must not replace undated annual values');
// 2) A shorter undated answer (one year lost).
assert.equal(historyIsThinner(snap(annual([182])), prior), true, 'shorter undated answer must not replace undated values');
// 3) Only one field shorter is enough.
assert.equal(historyIsThinner(snap({ ...annual([182, 95]), annualFCF: [6] }), prior), true, 'a single shorter field is a loss');
// 4) {value} cells count like plain numbers.
assert.equal(historyIsThinner(snap({ ...annual([182, 95]), annualRev: [{ value: 182 }] }), prior), true,
  'object cells count like numbers');
assert.equal(historyIsThinner(snap({ ...annual([182, 95]), annualRev: [{ value: 182 }, { value: 95 }] }), prior), false,
  'object cells of the same count are accepted');
// 5) Same length (window slide or revision) is not a loss.
assert.equal(historyIsThinner(snap(annual([200, 182])), prior), false, 'same-length undated answer is accepted');
// 6) A dated answer with at least as many values is accepted (dated periods are compared from then on).
assert.equal(historyIsThinner(snap(annual([200, 182], { annualRevEnds: ['2025-12-31', '2024-12-31'] })), prior), false,
  'dated answer with as many values is accepted');
// 7) Nothing stored, nothing to lose.
assert.equal(historyIsThinner(snap(annual([])), snap(annual([]))), false, 'empty over empty is no loss');
// 8) Nulls in the stored series are not values.
assert.equal(historyIsThinner(snap(annual([182])), snap(annual([182, null]))), false, 'a stored null is not a lost value');
// 9) Fully dated history keeps its existing rules (a new year that drops the oldest is accepted).
const dated = snap(annual([182, 95], { annualRevEnds: ['2024-12-31', '2023-12-31'] }));
assert.equal(historyIsThinner(snap(annual([200, 182], { annualRevEnds: ['2025-12-31', '2024-12-31'] })), dated), false,
  'dated window slide stays accepted');

console.log('reload-undated-annual: 9 checks green');
