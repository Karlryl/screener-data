#!/usr/bin/env node
'use strict';
/**
 * Feed fill guard (Daylauf 10, 30.10.2026): fails when a field of the published filter feed is filled on too
 * few rows. WHY: on 29.10. the distance to the 52-week high (d52) fell from 93 % to 74 % of the rows, the run
 * stayed green, and a lane found it by hand a day later. Cause: full pulls stored no price, and the stale-quarter
 * reload had just tripled them because the 30.06. quarters passed its 120-day age limit.
 *
 *   node scripts/feed-fill-guard.js --feed <universum.json> [--floors <file>] [--max-age-hours 24]
 *
 * Exit 0: every field at or above its floor in configs/feed-fill-floors.json.
 * Exit 1: a field below its floor, a field without a floor, an empty feed, or a feed older than the age limit
 * (a stale file on gh-pages would otherwise keep this guard green). Exit 2: unreadable input.
 * A pull request that deliberately empties a field lowers that floor in the same pull request.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FLOORS = path.join(__dirname, '..', 'configs', 'feed-fill-floors.json');
const DEFAULT_MAX_AGE_HOURS = 24;

const isFilled = value => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
const percent = value => value.toFixed(1).replace('.', ',') + ' %';

/**
 * @param {object} feed Parsed filter/universum.json.
 * @param {Object<string, number>} floors Lowest allowed share of filled rows per field, in percent.
 * @param {{now?: number, maxAgeHours?: number}} [options] Clock and age limit.
 * @returns {{shares: Object<string, number>, problems: string[]}} Share per field and one German sentence per finding.
 */
function checkFill(feed, floors, { now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  const rows = feed?.rows;
  if (!Array.isArray(rows) || !rows.length) return { shares: {}, problems: ['Der Filter-Feed hat keine Zeilen.'] };
  const problems = [];
  // A missing or unparsable stamp gives NaN and fails this comparison, on purpose.
  if (!((now - Date.parse(feed.generated_at)) / 36e5 <= maxAgeHours)) {
    problems.push(`Der Filter-Feed stammt vom ${feed.generated_at} und ist älter als ${maxAgeHours} Stunden, heute wurde also keiner veröffentlicht.`);
  }
  const fields = new Set(Object.keys(floors));
  for (const row of rows) for (const key of Object.keys(row)) fields.add(key);
  const shares = {};
  for (const field of fields) {
    shares[field] = 100 * rows.filter(row => isFilled(row[field])).length / rows.length;
    if (!(field in floors)) problems.push(`Das Feld ${field} steht im Filter-Feed, hat aber keine Untergrenze in configs/feed-fill-floors.json.`);
    else if (shares[field] < floors[field]) problems.push(`Das Feld ${field} ist nur auf ${percent(shares[field])} der ${rows.length} Zeilen gefüllt (Untergrenze ${percent(floors[field])}).`);
  }
  return { shares, problems };
}

function main(argv) {
  const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const feedFile = value('--feed');
  let feed, floors;
  try {
    if (!feedFile) throw new Error('--feed <universum.json> is required');
    feed = JSON.parse(fs.readFileSync(feedFile, 'utf8'));
    floors = JSON.parse(fs.readFileSync(value('--floors') ?? DEFAULT_FLOORS, 'utf8')).floors;
    if (!floors || typeof floors !== 'object') throw new Error('floors file without a floors object');
  } catch (error) {
    console.error('::error::Feed fill guard could not read its input: ' + error.message);
    return 2;
  }
  const maxAgeHours = Number(value('--max-age-hours') ?? DEFAULT_MAX_AGE_HOURS);
  const { shares, problems } = checkFill(feed, floors, { maxAgeHours });
  for (const [field, share] of Object.entries(shares)) console.log(field.padEnd(6), percent(share).padStart(9), ' floor', percent(floors[field] ?? NaN).padStart(9));
  for (const problem of problems) console.log('::error::' + problem);
  if (!problems.length) console.log('Every filter feed field is at or above its floor.');
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { checkFill, DEFAULT_FLOORS };
