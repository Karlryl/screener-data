'use strict';
const { produceRankings } = require('../src/scoring/score.js');

// Edge 1: hand-built results WITHOUT geo keys -> ?? null must hold shape
const handBuilt = [
  { ticker: 'AAA', action: 'route', formulaId: 'semiconductors', track: 'profitable', score: 90, lamps: [], overview: { kind:'gp', value: 0.5 } },
  { ticker: 'BBB', action: 'route', formulaId: 'semiconductors', track: 'profitable', score: 80, lamps: [], overview: { kind:'gp', value: 0.4 } },
  { ticker: 'CCC', action: 'survival', overview: { kind:'runway-badge', value: 12 }, lamps: [] },
  { ticker: 'DDD', action: 'exclude', reason: 'non_us' },
];
const r = produceRankings(handBuilt, { topN: 50 });
const row = r.branches.semiconductors.profitable[0];
console.log('Edge1 hand-built branch row keys:', Object.keys(row).join(','));
console.log('Edge1 country null held:', row.country === null, '| marketCap null held:', row.marketCap === null);
console.log('Edge1 _raw stripped from branch row:', !('_raw' in row));
console.log('Edge1 _raw stripped from overview row:', !('_raw' in r.overview[0]));
console.log('Edge1 survival row:', JSON.stringify(r.survival[0]));
console.log('Edge1 survival _raw absent:', !('_raw' in r.survival[0]));

// Edge 2: tie on _raw -> cmpTicker decides (stable). Build reversed insertion.
const tie = [
  { ticker: 'ZZZ', action: 'route', formulaId: 'x', track: 'profitable', score: 50, lamps: [], overview: null },
  { ticker: 'AAA', action: 'route', formulaId: 'x', track: 'profitable', score: 50, lamps: [], overview: null },
  { ticker: 'MMM', action: 'route', formulaId: 'x', track: 'profitable', score: 50, lamps: [], overview: null },
];
const rt = produceRankings(tie, { topN: 50 });
console.log('Edge2 tie order (must be AAA,MMM,ZZZ):', rt.branches.x.profitable.map(x=>x.ticker).join(','));
console.log('Edge2 overview tie order:', rt.overview.map(x=>x.ticker).join(','));

// Edge 3: survival with null/undefined runway + ticker tie
const sv = [
  { ticker: 'B', action: 'survival', overview: { kind:'runway-badge', value: null }, lamps: [] },
  { ticker: 'A', action: 'survival', overview: { kind:'runway-badge', value: null }, lamps: [] },
  { ticker: 'C', action: 'survival', overview: { kind:'runway-badge', value: 5 }, lamps: [] },
  { ticker: 'D', action: 'survival', overview: null, lamps: [] }, // overview null -> runwayQuarters null
];
const rs = produceRankings(sv, { topN: 50 });
console.log('Edge3 survival order (C first, then A,B by ticker, D last):',
  rs.survival.map(x=>x.ticker+':'+x.runwayQuarters).join(' '));

// Edge 4: 9999 cash-generating sentinel sorts to top, value preserved
const sv2 = [
  { ticker: 'X', action: 'survival', overview: { kind:'runway-badge', value: 9999 }, lamps: [] },
  { ticker: 'Y', action: 'survival', overview: { kind:'runway-badge', value: 100 }, lamps: [] },
];
const rs2 = produceRankings(sv2, { topN: 50 });
console.log('Edge4 sentinel sort:', rs2.survival.map(x=>x.ticker+':'+x.runwayQuarters).join(' '));

// Edge 5: topN=0 falls back to 50 (opts.topN || 50). Is that intended? branch cap then 50, overview 100.
const r0 = produceRankings(handBuilt, { topN: 0 });
console.log('Edge5 topN=0 -> defaults to 50; branch len capped to', '(uses 50):', 'overview slice topN*2 with topN=50');
// negative topN?
const rneg = produceRankings([
  { ticker:'A', action:'route', formulaId:'x', track:'profitable', score: 1, lamps:[], overview:null},
  { ticker:'B', action:'route', formulaId:'x', track:'profitable', score: 2, lamps:[], overview:null},
], { topN: -1 });
console.log('Edge5 topN=-1 -> overview.length:', rneg.overview.length, 'branch.x.profitable.length:', rneg.branches.x.profitable.length);

// Edge 6: round1 of overviewValue null
const r6 = produceRankings([
  { ticker:'A', action:'route', formulaId:'x', track:'profitable', score: 1, lamps:[], overview:{ kind:'gp', value: null }},
], { topN: 5 });
console.log('Edge6 overviewValue null preserved:', r6.overview[0].overviewValue === null, '| branch overview.value null:', r6.branches.x.profitable[0].overview.value === null);
