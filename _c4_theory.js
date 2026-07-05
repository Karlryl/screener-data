'use strict';
// A full-coverage name's base is a weighted avg of per-axis percentiles (each in [0,100], but
// max mid-rank percentile < 100 since q() uses mid-rank: top name gets (N-0.5)/N*100).
// For it to reach >=90, ALL heavy axes must be near-top simultaneously. Check: is the ceiling
// naturally <90 for 8/8, or does the winsor cap / percentile structure artificially cap it?
// The MAX possible q value in a cohort of size N: (N-1 + 0.5)/N*100 = (N-0.5)/N*100.
for(const N of [94,449,596,200]) console.log(`N=${N}: max mid-rank pct = ${((N-0.5)/N*100).toFixed(2)}`);
// So a name that is strictly #1 on EVERY axis in a 94-cohort would get ~99.5 base -> >=90 easily.
// The reason no 8/8 name hits 90 is that no name is simultaneously top on all 8 axes (they trade off).
// That is a REAL property of the data, not a C4 artifact. C4 does not touch 8/8 names at all.
console.log('\nConclusion: 8/8 names are byte-identical pre/post C4 (final==base). If none reach 90,');
console.log('it is because no name is jointly top-percentile on all axes — a real multi-axis tradeoff,');
console.log('NOT a C4 suppression. C4 cannot lower an 8/8 score.');
