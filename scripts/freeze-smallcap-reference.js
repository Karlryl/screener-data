'use strict';
// Writes the versioned fixed reference of the small-cap pass (coverage floor and score calibration) from a store.
// Renewing it moves visible scores: every new version gets its own before and after on one data day and an
// independent review. Refuses to write unless the file, read back, reproduces the live scores of that store exactly.
// node scripts/freeze-smallcap-reference.js --store <dir> --data-day 2026-10-31 --run <id> --version 2026-10-31.1 --renew-by 2027-02-15 --out configs/smallcap-reference.json
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadSmallcapUniverse, loadSmallcapReference, scoreSmallcapUniverse, SMALLCAP_COVERAGE_FLOOR_PCTL, SMALLCAP_WATCHLIST_PATH } = require('../src/scoring/run-screener.js');
const { scoreUniverse, quantile } = require('../src/scoring/score.js');
const { smallcapRoute } = require('../src/scoring/smallcap-route.js');
const formulas = require('../src/scoring/formulas/smallcap');

const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  if (i < 0 || !process.argv[i + 1]) throw new Error('missing --' + name);
  return process.argv[i + 1];
};
const store = arg('store'), out = arg('out');
const scored = (rows) => rows.filter((e) => e.action === 'route' && e.score !== null);

const live = scoreUniverse(loadSmallcapUniverse(store), formulas, { classify: smallcapRoute, growthBoost: false });
const coverageFloor = quantile(scored(live).map((e) => e.coverageWeight).filter(Number.isFinite), SMALLCAP_COVERAGE_FLOOR_PCTL);
if (!(coverageFloor > 0)) throw new Error('no coverage floor from ' + store);
const storeHash = crypto.createHash('sha256');
for (const name of fs.readdirSync(store).sort()) storeHash.update(name).update(fs.readFileSync(path.join(store, name)));
fs.writeFileSync(out, JSON.stringify({
  schema: 'smallcap-reference/v1', version: arg('version'), dataDay: arg('data-day'), sourceRun: arg('run'), renewBy: arg('renew-by'),
  // The committed form of the watchlist, whatever line ending this checkout has.
  storeSha256: storeHash.digest('hex'), watchlistSha256: crypto.createHash('sha256').update(fs.readFileSync(SMALLCAP_WATCHLIST_PATH, 'utf8').replace(/\r\n/g, '\n')).digest('hex'),
  coverageFloor, calibration: live.calibration,
}) + '\n');

const frozen = scoreSmallcapUniverse(loadSmallcapUniverse(store), loadSmallcapReference(out));
const before = new Map(scored(live).map((e) => [e.ticker, e.score]));
const moved = scored(frozen).filter((e) => before.get(e.ticker) !== e.score).map((e) => e.ticker);
if (moved.length || scored(frozen).length !== before.size) throw new Error(`reference does not reproduce its store: ${moved.length} scores moved, ${scored(frozen).length} rows against ${before.size}`);
console.log(`reference ${arg('version')}: floor ${coverageFloor}, ${before.size} rows reproduced exactly -> ${out}`);
