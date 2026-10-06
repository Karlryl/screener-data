'use strict';

const { alterTage, istVeraltet } = require('./alter.js');

const RUN_HOUR = 2;
const RUN_MINUTE = 17;
const DEADLINE_HOUR = 12;
const DEADLINE_MINUTE = 30;
const RUN_WEEKDAYS = Object.freeze([2, 3, 4, 5, 6]);

// daily-pull's UTC cron is 17 2 * * 2-6; a run is due at 12:30 that day.
function faelligerLaufStart(jetztMs) {
  if (!Number.isFinite(jetztMs)) throw new RangeError('Ungueltiger Zeitpunkt');
  const day = new Date(jetztMs);
  day.setUTCHours(0, 0, 0, 0);
  while (Number.isFinite(day.getTime())) {
    const deadline = day.getTime() + (DEADLINE_HOUR * 60 + DEADLINE_MINUTE) * 60000;
    if (RUN_WEEKDAYS.includes(day.getUTCDay()) && deadline <= jetztMs) {
      return day.setUTCHours(RUN_HOUR, RUN_MINUTE, 0, 0);
    }
    day.setUTCDate(day.getUTCDate() - 1);
  }
  throw new RangeError('Zeitpunkt ausserhalb des Kalenderbereichs');
}

function faelligerLaufTag(jetztMs) {
  return new Date(faelligerLaufStart(jetztMs)).toISOString().slice(0, 10);
}

function istUeberfaellig({ stempelMs, jetztMs, maxTage }) {
  if (!Number.isFinite(stempelMs)) return true;
  // istVeraltet: null age or unusable limit counts as stale, like the flat rule.
  return istVeraltet(alterTage(stempelMs, jetztMs), maxTage) && stempelMs < faelligerLaufStart(jetztMs);
}

function vintageMs(datum) {
  if (typeof datum !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return NaN;
  const ms = Date.parse(datum + 'T00:00:00Z');
  // Date.parse normalizes impossible dates such as February 30.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === datum ? ms : NaN;
}

function istVintageUeberfaellig({ datum, jetztMs, maxTage }) {
  const stempelMs = vintageMs(datum);
  if (!Number.isFinite(stempelMs)) return true;
  return istVeraltet(alterTage(stempelMs, jetztMs), maxTage) && datum < faelligerLaufTag(jetztMs);
}

function erwartung(jetztMs) {
  const day = new Date(faelligerLaufStart(jetztMs));
  const weekday = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][day.getUTCDay()];
  const pad = value => String(value).padStart(2, '0');
  return `faelliger Lauf: ${weekday} ${pad(day.getUTCDate())}.${pad(day.getUTCMonth() + 1)}. ` +
    `(Di-Sa ${pad(RUN_HOUR)}:${pad(RUN_MINUTE)} UTC, Frist ${pad(DEADLINE_HOUR)}:${pad(DEADLINE_MINUTE)} UTC)`;
}

module.exports = {
  RUN_HOUR, RUN_MINUTE, DEADLINE_HOUR, DEADLINE_MINUTE, RUN_WEEKDAYS,
  faelligerLaufStart, faelligerLaufTag, istUeberfaellig, istVintageUeberfaellig, erwartung,
};

// Require an explicit zone so CLI results never depend on the machine's timezone.
function isoMs(value) {
  if (!/^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-][0-2]\d:[0-5]\d)$/.test(value)) return NaN;
  if (!Number.isFinite(vintageMs(value.slice(0, 10)))) return NaN;
  return Date.parse(value);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const [mode, value, limit] = args;
  const maxTage = Number(limit);
  const jetztMs = process.env.HEARTBEAT_NOW === undefined ? Date.now() : isoMs(process.env.HEARTBEAT_NOW);
  if (args.length !== 3 || !['stempel', 'vintage'].includes(mode) || !limit.trim() ||
      !Number.isFinite(maxTage) || maxTage < 0 || !Number.isFinite(jetztMs)) {
    console.error('Aufruf: node lib/liefer-kalender.js stempel <ISO> <maxTage> | vintage <YYYY-MM-DD> <maxTage>; maxTage >= 0, HEARTBEAT_NOW optional als ISO-Zeitpunkt.');
    process.exitCode = 2;
  } else {
    const overdue = mode === 'stempel'
      ? istUeberfaellig({ stempelMs: isoMs(value), jetztMs, maxTage })
      : istVintageUeberfaellig({ datum: value, jetztMs, maxTage });
    console.log(`${overdue ? 'ueberfaellig' : 'nicht ueberfaellig'}; ${erwartung(jetztMs)}`);
    process.exitCode = overdue ? 1 : 0;
  }
}
