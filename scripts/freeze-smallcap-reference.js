'use strict';
// Writes the versioned fixed reference of the small-cap pass (coverage floor and score calibration) from a store.
// Renewing it moves visible scores: every new version gets its own before and after on one data day and an
// independent review. Refuses to write unless the file, read back, reproduces the live scores of that store exactly.
// node scripts/freeze-smallcap-reference.js --store <dir> --data-day 2026-10-31 --run <id> --version 2026-10-31.1 --renew-by 2027-02-15 --out configs/smallcap-reference.json
const arg = (name) => {
  const i = process.argv.indexOf('--' + name);
  if (i < 0 || !process.argv[i + 1]) throw new Error('missing --' + name);
  return process.argv[i + 1];
};
// #88 review 07.11.2026: the age rule (lib/annual-pairs.js) judges series against RUN_DATE_UTC. Without it the reference was
// frozen with the rule off and its self-check still passed (floor 0.573 instead of 0.48 on the store of 31.10.2026), so the
// reference is frozen at its own data day, before anything is required.
const dataDay = arg('data-day');
if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDay)) throw new Error('--data-day must be YYYY-MM-DD: ' + dataDay);
if (process.env.RUN_DATE_UTC && process.env.RUN_DATE_UTC.slice(0, 10) !== dataDay) throw new Error(`RUN_DATE_UTC ${process.env.RUN_DATE_UTC} differs from --data-day ${dataDay}`);
process.env.RUN_DATE_UTC = dataDay;
if (require('../lib/annual-pairs.js').dataDay() !== dataDay) throw new Error('--data-day is not a calendar day: ' + dataDay); // review N4: 2026-02-30 turned the rule off
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadSmallcapUniverse, loadSmallcapReference, scoreSmallcapUniverse, SMALLCAP_COVERAGE_FLOOR_PCTL, SMALLCAP_WATCHLIST_PATH } = require('../src/scoring/run-screener.js');
const { scoreUniverse, quantile } = require('../src/scoring/score.js');
const { smallcapRoute } = require('../src/scoring/smallcap-route.js');
const formulas = require('../src/scoring/formulas/smallcap');

const store = arg('store'), out = arg('out');
const scored = (rows) => rows.filter((e) => e.action === 'route' && e.score !== null);

const live = scoreUniverse(loadSmallcapUniverse(store), formulas, { classify: smallcapRoute, growthBoost: false });
const coverageFloor = quantile(scored(live).map((e) => e.coverageWeight).filter(Number.isFinite), SMALLCAP_COVERAGE_FLOOR_PCTL);
if (!(coverageFloor > 0)) throw new Error('no coverage floor from ' + store);
const storeHash = crypto.createHash('sha256');
for (const name of fs.readdirSync(store).sort()) storeHash.update(name).update(fs.readFileSync(path.join(store, name)));
fs.writeFileSync(out, JSON.stringify({
  schema: 'smallcap-reference/v1', version: arg('version'), dataDay, sourceRun: arg('run'), renewBy: arg('renew-by'),
  // The committed form of the watchlist, whatever line ending this checkout has.
  storeSha256: storeHash.digest('hex'), watchlistSha256: crypto.createHash('sha256').update(fs.readFileSync(SMALLCAP_WATCHLIST_PATH, 'utf8').replace(/\r\n/g, '\n')).digest('hex'),
  coverageFloor, calibration: live.calibration,
}) + '\n');

const frozen = scoreSmallcapUniverse(loadSmallcapUniverse(store), loadSmallcapReference(out));
const before = new Map(scored(live).map((e) => [e.ticker, e.score]));
const moved = scored(frozen).filter((e) => before.get(e.ticker) !== e.score).map((e) => e.ticker);
if (moved.length || scored(frozen).length !== before.size) throw new Error(`reference does not reproduce its store: ${moved.length} scores moved, ${scored(frozen).length} rows against ${before.size}`);
console.log(`reference ${arg('version')}: floor ${coverageFloor}, ${before.size} rows reproduced exactly -> ${out}`);
