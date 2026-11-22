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
 * A pull request that deliberately empties a field either lowers that floor in the same pull request, or the writer
 * gives each emptied value a reason this guard knows (explained() below).
 * Explained (Daylauf 16, 12.11.2026): stale Yahoo quotes remove withheld values from their field's denominator under
 * the erklaertMax cap. Since 22.11.2026, fcf-alt does the same for Rule of 40 with growth and empty FCF under its own
 * fcfAltMax cap, both caps measured against all rows so a mass loss stays red.
 * Red spot (Rotstelle): an intended loss found after the fact gets an entry under "rotstellen" in the floors file
 * (temporary floor, owner, reason, seit, bis at most 14 days later). Until bis the temporary floor applies and the run
 * names the red spot as a warning; from the day after bis the entry itself is an error until it is removed. seit and bis
 * both count, so bis = seit + 13 gives 14 days.
 * ponytail: fixed floors, about 5 points under the measured share, so a smaller loss stays green and a floor does
 * not rise with a recovered field. Compare with the previous day's feed if a loss of that size ever matters.
 */
const fs = require('node:fs');
const path = require('node:path');
const { STALE_PRICE_RETURN } = require('../lib/market-cap-guard.js');
const { SEKTOR_AUSSCHLUSS } = require('./write-rule40-export.js');

const DEFAULT_FLOORS = path.join(__dirname, '..', 'configs', 'feed-fill-floors.json');
const DEFAULT_MAX_AGE_HOURS = 24;

const isFilled = value => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
const percent = value => value.toFixed(1).replace('.', ',') + ' %';

// The reasons scripts/write-filter-universe.js attaches when it withholds a value on a stale Yahoo quote (Tag 1538).
// Its own hint per Yahoo value starts with the label; tests/feed-fill-guard.test.js runs the real writer against this.
const HIDDEN_LABEL = { pe: 'P/E', fpe: 'Forward P/E', dy: 'Dividendenrendite', d52: 'Abstand zum 52-Wochen-Hoch', ath: 'Abstand zum Allzeithoch' };
// The market cap reason ends with STALE_PRICE_RETURN. The same withhold empties P/S and EV/S (DERIVED_FIELDS in
// lib/market-cap-guard.js), and a missing market cap makes the row data-suspect, which takes its Rule of 40 (B5 in
// isDataSuspect, src/scoring/score.js; 11.11.: 712 of 712 lost r40 values on stale rows).
// ps, evs and r40 get no hint of their own (the feed is at 5.9 of 6 MB), so a stale row also counts when it never had the
// value. r40 counts only beside g and fcf, or g plus fcf-alt with empty fcf (12.11. quote count: 800 rows,
// 709 of them had r40 on 07.11.; without that 1,142 and 718). For ps and evs the feed holds no input, so their
// floors carry the measured excess (Daylauf 16).
const STALE_FIELDS = new Set(['mc', 'ps', 'evs', 'r40']);
// ponytail: only the exact stale-quote hints and the writer's fcf-alt code count; both have writer tests.
function explanation(row, field) {
  const aus = Array.isArray(row.aus) ? row.aus.filter(a => typeof a === 'string') : [];
  if (HIDDEN_LABEL[field]) return aus.some(a => a.startsWith(HIDDEN_LABEL[field] + ' wird nicht gezeigt, ')) ? 'quote' : null;
  const staleQuote = STALE_FIELDS.has(field) && aus.some(a => a.endsWith(STALE_PRICE_RETURN));
  if (field === 'r40') {
    if (!isFilled(row.g)) return null;
    const fcfAlt = !isFilled(row.fcf) && aus.includes('fcf-alt');
    // A row with both reasons belongs to the quote cap, even when stale FCF also withholds r40.
    if (staleQuote && (isFilled(row.fcf) || fcfAlt)) return 'quote';
    return fcfAlt && !SEKTOR_AUSSCHLUSS.includes(row.s) ? 'fcf-alt' : null;
  }
  return staleQuote ? 'quote' : null;
}
function explained(row, field) { return explanation(row, field) !== null; }

/**
 * @param {object} feed Parsed filter/universum.json.
 * @param {Object<string, number>} floors Lowest allowed share of filled rows per field, in percent.
 * @param {{now?: number, maxAgeHours?: number, rotstellen?: object, explainedMax?: number, fcfAltMax?: number}} [options]
 *   Clock, age limit, red spots, and separate quote and stale-FCF caps; both default to 0, fail-closed.
 * @returns {{shares: Object<string, number>, explainedShares: Object<string, number>, fcfAltShares: Object<string, number>, problems: string[], notices: string[], floors: Object<string, number>}}
 *   Fill share among showable rows, quote and stale-FCF shares of all rows, findings, notices and applied floors.
 */
function checkFill(feed, floors, { now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS, rotstellen = {}, explainedMax = 0, fcfAltMax = 0 } = {}) {
  const rows = feed?.rows;
  if (!Array.isArray(rows) || !rows.length) return { shares: {}, explainedShares: {}, fcfAltShares: {}, problems: ['Der Filter-Feed hat keine Zeilen.'], notices: [] };
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
  const shares = {}, explainedShares = {}, fcfAltShares = {};
  for (const field of fields) {
    let filled = 0, quoteWithheld = 0, fcfAltWithheld = 0;
    for (const row of rows) {
      if (isFilled(row[field])) { filled++; continue; }
      const reason = explanation(row, field);
      if (reason === 'quote') quoteWithheld++;
      else if (reason === 'fcf-alt') fcfAltWithheld++;
    }
    const withheld = quoteWithheld + fcfAltWithheld;
    const shown = rows.length - withheld;
    shares[field] = shown ? 100 * filled / shown : 0;
    explainedShares[field] = 100 * quoteWithheld / rows.length;
    fcfAltShares[field] = 100 * fcfAltWithheld / rows.length;
    if (!(field in floors)) problems.push(`Das Feld ${field} steht im Filter-Feed, hat aber keine Untergrenze in configs/feed-fill-floors.json.`);
    else if (shown && shares[field] < effective[field]) problems.push(`Das Feld ${field} ist nur auf ${percent(shares[field])} der ${shown} Zeilen gefüllt, auf denen es gezeigt werden kann (Untergrenze ${percent(effective[field])}).`);
    if (explainedShares[field] > explainedMax) problems.push(`Das Feld ${field} ist auf ${percent(explainedShares[field])} der ${rows.length} Zeilen wegen eines zu alten Kurses ausgeblendet, erlaubt sind höchstens ${percent(explainedMax)}. So viele alte Kurse deuten auf eine Störung beim Kursabruf, nicht auf einzelne Zeilen.`);
    if (fcfAltShares[field] > fcfAltMax) problems.push(`Das Feld ${field} ist auf ${percent(fcfAltShares[field])} der ${rows.length} Zeilen ausgeblendet, weil der Free Cashflow veraltet ist; erlaubt sind höchstens ${percent(fcfAltMax)}. So viele veraltete Cashflows deuten auf eine Störung beim Abruf der Kapitalflussrechnung, nicht auf einzelne Zeilen.`);
  }
  for (const field of active) if (shares[field] >= floors[field]) notices.push(`Das Feld ${field} steht mit ${percent(shares[field])} wieder über seiner normalen Untergrenze, die Rotstelle kann weg.`);
  return { shares, explainedShares, fcfAltShares, problems, notices, floors: effective };
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
  // seit and bis both count: bis = seit + 13 is the 14th day.
  if (days[1] < days[0] || days[1] - days[0] > (MAX_ROTSTELLE_DAYS - 1) * 864e5) return `bis darf höchstens ${MAX_ROTSTELLE_DAYS - 1} Tage nach seit liegen (beide Tage zählen, ${MAX_ROTSTELLE_DAYS} Tage)`;
  for (const key of ['zustaendig', 'grund']) if (typeof spot[key] !== 'string' || !spot[key].trim()) return `${key} fehlt`;
  return null;
}

function main(argv) {
  const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const feedFile = value('--feed');
  let feed, floors, rotstellen, erklaertMax, fcfAltMax;
  try {
    if (!feedFile) throw new Error('--feed <universum.json> is required');
    feed = JSON.parse(fs.readFileSync(feedFile, 'utf8'));
    ({ floors, rotstellen = {}, erklaertMax, fcfAltMax } = JSON.parse(fs.readFileSync(value('--floors') ?? DEFAULT_FLOORS, 'utf8')));
    if (!floors || typeof floors !== 'object') throw new Error('floors file without a floors object');
    if (!rotstellen || typeof rotstellen !== 'object' || Array.isArray(rotstellen)) throw new Error('rotstellen must be an object');
    // At most half: a cap of 100 would let a field hidden on every row pass (the floor sentence needs a row that can show it).
    if (!(Number.isFinite(erklaertMax) && erklaertMax >= 0 && erklaertMax <= 50)) throw new Error('erklaertMax must be a percentage from 0 to 50');
    if (!(Number.isFinite(fcfAltMax) && fcfAltMax >= 0 && fcfAltMax <= 50)) throw new Error('fcfAltMax must be a percentage from 0 to 50');
  } catch (error) {
    console.error('::error::Der Füllstand des Filter-Feeds ist heute nicht geprüft, die Eingabe ist nicht lesbar: ' + error.message);
    return 2;
  }
  const maxAgeHours = Number(value('--max-age-hours') ?? DEFAULT_MAX_AGE_HOURS);
  const { shares, explainedShares = {}, fcfAltShares = {}, problems, notices, floors: applied = floors } = checkFill(feed, floors, { maxAgeHours, rotstellen, explainedMax: erklaertMax, fcfAltMax });
  for (const notice of notices) console.log('::warning::' + notice);
  for (const [field, share] of Object.entries(shares)) console.log(field.padEnd(6), percent(share).padStart(9), ' floor', percent(applied[field] ?? NaN).padStart(9),
    explainedShares[field] ? ` explained ${percent(explainedShares[field])} of all rows` : '',
    fcfAltShares[field] ? ` fcf-alt ${percent(fcfAltShares[field])} of all rows` : '', applied[field] !== floors[field] ? '(Rotstelle)' : '');
  for (const problem of problems) console.log('::error::' + problem);
  if (!problems.length) console.log('Every filter feed field is at or above its floor.');
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { checkFill, rotstelleFault, explained, DEFAULT_FLOORS };
