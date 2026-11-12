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
 * Red spot (Rotstelle): an intended loss found after the fact gets an entry under "rotstellen" in the floors file
 * (temporary floor, owner, reason, seit, bis at most 14 days later). Until bis the temporary floor applies and the run
 * names the red spot as a warning; from the day after bis the entry itself is an error until it is removed. seit and bis
 * both count, so bis = seit + 13 gives 14 days.
 * ponytail: fixed floors, about 5 points under the measured share, so a smaller loss stays green and a floor does
 * not rise with a recovered field. Compare with the previous day's feed if a loss of that size ever matters.
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
 * @param {{now?: number, maxAgeHours?: number, rotstellen?: object}} [options] Clock, age limit and red spots by field.
 * @returns {{shares: Object<string, number>, problems: string[], notices: string[], floors: Object<string, number>}}
 *   Share per field, one German sentence per finding and per active red spot, and the floors actually applied.
 */
function checkFill(feed, floors, { now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS, rotstellen = {} } = {}) {
  const rows = feed?.rows;
  if (!Array.isArray(rows) || !rows.length) return { shares: {}, problems: ['Der Filter-Feed hat keine Zeilen.'], notices: [] };
  const problems = [], notices = [];
  const today = new Date(now).toISOString().slice(0, 10);
  const effective = { ...floors }, active = [];
  for (const [field, spot] of Object.entries(rotstellen ?? {})) {
    const fault = rotstelleFault(field, spot, floors);
    if (fault) { problems.push(`Die Rotstelle für das Feld ${field} ist ungültig: ${fault}.`); continue; }
    if (today > spot.bis) {
      problems.push(`Die Rotstelle für das Feld ${field} ist am ${spot.bis} abgelaufen (zuständig: ${spot.zustaendig}). Ursache klären und den Eintrag aus configs/feed-fill-floors.json entfernen.`);
    } else if (today >= spot.seit) {
      effective[field] = spot.floor; active.push(field);
      notices.push(`Rotstelle bis ${spot.bis}, zuständig ${spot.zustaendig}: das Feld ${field} wird gegen ${percent(spot.floor)} statt ${percent(floors[field])} geprüft. ${spot.grund}`);
    }
  }
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
    else if (shares[field] < effective[field]) problems.push(`Das Feld ${field} ist nur auf ${percent(shares[field])} der ${rows.length} Zeilen gefüllt (Untergrenze ${percent(effective[field])}).`);
  }
  for (const field of active) if (shares[field] >= floors[field]) notices.push(`Das Feld ${field} steht mit ${percent(shares[field])} wieder über seiner normalen Untergrenze, die Rotstelle kann weg.`);
  return { shares, problems, notices, floors: effective };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROTSTELLE_DAYS = 14;
// One German clause per defect of a red-spot entry, or null when it is usable.
function rotstelleFault(field, spot, floors) {
  if (!(field in floors)) return 'das Feld hat keine Untergrenze';
  if (!spot || typeof spot !== 'object') return 'kein Eintrag';
  if (!(Number.isFinite(spot.floor) && spot.floor >= 0 && spot.floor < floors[field])) return 'die vorläufige Untergrenze muss eine Zahl unter der normalen sein';
  const days = [spot.seit, spot.bis].map(d => (typeof d === 'string' && DAY.test(d) ? Date.parse(d + 'T00:00:00Z') : NaN));
  if (!days.every(Number.isFinite) || new Date(days[0]).toISOString().slice(0, 10) !== spot.seit || new Date(days[1]).toISOString().slice(0, 10) !== spot.bis) return 'seit und bis müssen echte Tage JJJJ-MM-TT sein';
  if (days[1] < days[0] || days[1] - days[0] > MAX_ROTSTELLE_DAYS * 864e5) return `bis muss zwischen seit und ${MAX_ROTSTELLE_DAYS} Tagen danach liegen`;
  for (const key of ['zustaendig', 'grund']) if (typeof spot[key] !== 'string' || !spot[key].trim()) return `${key} fehlt`;
  return null;
}

function main(argv) {
  const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const feedFile = value('--feed');
  let feed, floors, rotstellen;
  try {
    if (!feedFile) throw new Error('--feed <universum.json> is required');
    feed = JSON.parse(fs.readFileSync(feedFile, 'utf8'));
    ({ floors, rotstellen = {} } = JSON.parse(fs.readFileSync(value('--floors') ?? DEFAULT_FLOORS, 'utf8')));
    if (!floors || typeof floors !== 'object') throw new Error('floors file without a floors object');
    if (!rotstellen || typeof rotstellen !== 'object' || Array.isArray(rotstellen)) throw new Error('rotstellen must be an object');
  } catch (error) {
    console.error('::error::Der Füllstand des Filter-Feeds ist heute nicht geprüft, die Eingabe ist nicht lesbar: ' + error.message);
    return 2;
  }
  const maxAgeHours = Number(value('--max-age-hours') ?? DEFAULT_MAX_AGE_HOURS);
  const { shares, problems, notices, floors: applied = floors } = checkFill(feed, floors, { maxAgeHours, rotstellen });
  for (const notice of notices) console.log('::warning::' + notice);
  for (const [field, share] of Object.entries(shares)) console.log(field.padEnd(6), percent(share).padStart(9), ' floor', percent(applied[field] ?? NaN).padStart(9), applied[field] !== floors[field] ? '(Rotstelle)' : '');
  for (const problem of problems) console.log('::error::' + problem);
  if (!problems.length) console.log('Every filter feed field is at or above its floor.');
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { checkFill, rotstelleFault, DEFAULT_FLOORS };
