'use strict';
/**
 * Untangle finding F002 (13.11.2026): the deadline report of the share-count hand table (lib/handtabellen-fristen.js) ran
 * only inside scripts/tageslauf-erwartungen.js, which no workflow starts. Rows marked withholdUnverified stop applying after
 * their reviewBy and the board market cap goes empty (lib/market-cap-guard.js), so 13 of 15 such rows would have blanked a
 * market cap by 31.12.2026 without any visible notice. This CLI runs in the daily-pull scoring job right after the filter
 * universe and prints every deadline line as a GitHub warning plus the step summary. Reporting only: exit code is always 0,
 * a missing input is named, never read as an all-clear. It never invents or extends a share count.
 *
 *   node scripts/handtabellen-fristen-melden.js [--universum <filter/universum.json>] [--tabelle <share-count table>] [--datum YYYY-MM-DD] [--tage 30]
 */
const fs = require('node:fs');
const path = require('node:path');
const { fristen } = require('../lib/handtabellen-fristen.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULTS = {
  universum: path.join(ROOT, 'outputs', 'findash-export', 'v1', 'filter', 'universum.json'),
  tabelle: path.join(ROOT, 'configs', 'share-count-hand-table.json'),
};

const arg = (argv, name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };

/**
 * Builds the report lines; GitHub warnings for deadlines that empty a board value, notices for the rest.
 * @param {string[]} argv Command-line arguments.
 * @param {object} env Environment (RUN_DATE_UTC is the data day).
 * @returns {{lines: string[], faellt: number}} Output lines and the number of expiring withholdUnverified rows.
 */
function melden(argv, env) {
  const datum = arg(argv, 'datum') || (/^\d{4}-\d{2}-\d{2}/.test(env.RUN_DATE_UTC || '') ? env.RUN_DATE_UTC.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const tage = Number(arg(argv, 'tage') || 30);
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  let universum, tabelle;
  try {
    universum = read(arg(argv, 'universum') || DEFAULTS.universum).rows;
    if (!Array.isArray(universum)) throw new Error('filter/universum.json ohne rows');
    tabelle = read(arg(argv, 'tabelle') || DEFAULTS.tabelle);
  } catch (err) {
    return { lines: [`::warning title=Handtabelle Fristen::Die Fristen der Aktienzahl-Handtabelle sind heute nicht prüfbar (${err.message}); das ist keine Entwarnung.`], faellt: 0 };
  }
  const r = fristen({ tabelle, universum, datum, tage });
  const lines = r.zeilen.map(z => (/^(Frist|Hinweis|Warnung)/.test(z) ? `::warning title=Handtabelle Fristen::${z}` : z));
  if (!r.zeilen.length) lines.push(`Keine Frist der Aktienzahl-Handtabelle in den nächsten ${tage} Tagen (Datentag ${datum}).`);
  return { lines, faellt: r.faellt.length };
}

if (require.main === module) {
  let out;
  try { out = melden(process.argv.slice(2), process.env); }
  catch (err) { out = { lines: [`::warning title=Handtabelle Fristen::Fristenbericht fehlgeschlagen (${err.message}); das ist keine Entwarnung.`] }; }
  for (const l of out.lines) console.log(l);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['### Fristen der Aktienzahl-Handtabelle', '', ...out.lines.map(l => '- ' + l.replace(/^::warning title=[^:]*::/, '')), ''].join('\n') + '\n'); }
    catch (err) { console.log(`::warning::Step-Summary nicht schreibbar (${err.message})`); }
  }
  process.exitCode = 0;
}

module.exports = { melden };
