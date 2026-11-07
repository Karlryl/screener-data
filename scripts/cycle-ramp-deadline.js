'use strict';
const fs = require('node:fs');
const path = require('node:path');
const TRANSITION = path.resolve(__dirname, '../protocol/gqs-00/1.2.0-pending/transition.json');

function hasLegacy(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'scoreCycleLegacy') || Object.hasOwn(value.factors || {}, 'cycleLegacy')) return true;
  return Object.values(value).some(hasLegacy);
}

// Read actual export files, including quality/full/smallcap; never follow links or write data.
function exportedLegacy(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && exportedLegacy(file)) return true;
    if (entry.isFile() && entry.name.endsWith('.json') && hasLegacy(JSON.parse(fs.readFileSync(file, 'utf8')))) return true;
  }
  return false;
}

/** Reporting only: an expired comparison or an unreadable guard input never fails the export.
 * @param {string} outDir Actual export root.
 * @param {object} [options] Fixed clock, transition path and warning sink for hermetic tests.
 * @returns {object} Reporting status, never a validation error or an exit code.
 */
function reportCycleRampDeadline(outDir, { now = new Date(), transitionFile = TRANSITION, warn = console.warn } = {}) {
  try {
    const comparison = JSON.parse(fs.readFileSync(transitionFile, 'utf8')).cycleRamp?.comparison;
    if (!comparison) throw new Error('Vergleichsfrist fehlt');
    const { endsOn } = comparison;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || !Number.isFinite(Date.parse(endsOn))
      || new Date(endsOn).toISOString().slice(0, 10) !== endsOn) throw new Error('endsOn ist kein gueltiges Datum');
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = type => parts.find(p => p.type === type).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    if (today <= endsOn) return { today, endsOn, overdue: false };
    const legacyExported = exportedLegacy(outDir);
    if (legacyExported) warn(`::warning::Zyklusvergleich seit ${endsOn} beendet (heute ${today}, Europe/Berlin); alte Vergleichsfelder werden weiter exportiert. Gepruefte Entfernung nachholen. Der Datenlauf bleibt unveraendert.`);
    return { today, endsOn, overdue: true, legacyExported };
  } catch (error) {
    warn('::warning::Zyklusvergleich-Frist konnte nicht geprueft werden: ' + error.message + '. Der Datenlauf bleibt unveraendert.');
    return { error: error.message };
  }
}

module.exports = { reportCycleRampDeadline };
