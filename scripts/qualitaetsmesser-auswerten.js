'use strict';
// S11 monthly quality meter, step 2 (read-only except ergebnis.json): aggregates the two check rounds of one measurement
// exactly like the baseline of 22.11.2026 (auswerten.js in C:\Users\Anwender\.codex\reports\s11-qualitaetsmesser-2026-11-22\).
// Rule (pre-registered): a value counts as an error only where both rounds see wrong or stale; a value only one round
// could verify, or the rounds disagree on, is disputed and counts in neither numerator nor denominator; a round-1 value
// without a round-2 recheck keeps its round-1 class. Rate = errors / (values - disputed - not verifiable), Wilson 95 %.
//
// Usage: node scripts/qualitaetsmesser-auswerten.js --dir <measurement folder>
//   The folder holds sample.json, round 1 as check-g<n>.json and round 2 as recheck-r<n>.json (JSON arrays {id, classification}).
//   Writes <folder>/ergebnis.json. Exit 0 written, 1 inputs missing or inconsistent, 2 bad arguments.
const fs = require('fs');
const path = require('path');

const CLASSES = new Set(['correct', 'wrong', 'stale', 'not_verifiable']);
const bad = c => c === 'wrong' || c === 'stale';

/**
 * Final class of one value from its two rounds.
 * @param {string} a Round-1 class.
 * @param {string|null} b Round-2 class, null when the value was not rechecked.
 * @returns {string} correct | wrong | stale | wrong-or-stale | disputed | not_verifiable
 */
function finalClass(a, b) {
  if (!b) return a; // correct values not drawn as control stay correct
  if (a === 'not_verifiable' || b === 'not_verifiable') return a === 'not_verifiable' && b === 'not_verifiable' ? 'not_verifiable' : 'disputed';
  if (bad(a) && bad(b)) return a === 'wrong' && b === 'wrong' ? 'wrong' : a === 'stale' && b === 'stale' ? 'stale' : 'wrong-or-stale';
  if (a === 'correct' && b === 'correct') return 'correct';
  return 'disputed';
}

/**
 * Wilson score interval, 95 %, in percent.
 * @param {number} k Errors.
 * @param {number} n Checkable values.
 * @returns {[number, number]}
 */
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [(c - h) * 100, (c + h) * 100];
}

/**
 * Aggregate one measurement.
 * @param {object[]} sample Entries of sample.json.
 * @param {object[]} round1 Round-1 checks, one per sample id.
 * @param {object[]} round2 Round-2 rechecks (a subset of ids).
 * @returns {object} {gesamt, liste, land, feld, rows}
 */
function aggregate(sample, round1, round2) {
  const s = new Map(sample.map(x => [x.id, x]));
  const seen = new Set();
  for (const [label, round] of [['round 1', round1], ['round 2', round2]]) {
    const ids = new Set();
    for (const x of round) {
      if (!s.has(x.id)) throw new Error(`${label}: id ${x.id} is not in the sample`);
      if (!CLASSES.has(x.classification)) throw new Error(`${label}: id ${x.id} has class ${JSON.stringify(x.classification)}`);
      if (ids.has(x.id)) throw new Error(`${label}: id ${x.id} twice`);
      ids.add(x.id);
    }
    if (label === 'round 1') for (const id of ids) seen.add(id);
  }
  const missing = sample.filter(x => !seen.has(x.id)).map(x => x.id);
  if (missing.length) throw new Error('round 1 misses ids ' + missing.join(', '));
  const R2 = new Map(round2.map(x => [x.id, x]));
  const rows = round1.map(a => {
    const b = R2.get(a.id), x = s.get(a.id);
    return { id: a.id, ticker: x.ticker, field: x.field, stratum: x.stratum.split('/')[0], country: x.country, r1: a.classification, r2: b ? b.classification : null, final: finalClass(a.classification, b ? b.classification : null) };
  });
  const tab = (label, sel) => {
    const g = rows.filter(sel), c = {};
    for (const r of g) c[r.final] = (c[r.final] || 0) + 1;
    const err = (c.wrong || 0) + (c.stale || 0) + (c['wrong-or-stale'] || 0);
    const n = g.length - (c.disputed || 0) - (c.not_verifiable || 0);
    const [lo, hi] = wilson(err, n);
    return { label, values: g.length, ...c, err, n, rate: n ? +(100 * err / n).toFixed(1) : null, ci: [+lo.toFixed(1), +hi.toFixed(1)] };
  };
  return {
    gesamt: tab('alle', () => true),
    liste: ['HyperGrowth', 'Rule40', 'Filter'].map(l => tab(l, r => r.stratum === l)),
    land: [['USA', r => r.country === 'United States'], ['China', r => r.country === 'China'], ['übrige', r => r.country !== 'United States' && r.country !== 'China']].map(([l, f]) => tab(l, f)),
    feld: [...new Set(rows.map(r => r.field))].map(f => tab(f, r => r.field === f)),
    rows,
  };
}

/**
 * Read the round files of a folder in numeric order (check-g1, check-g2, ... / recheck-r1, ...).
 * @param {string} dir Measurement folder.
 * @param {RegExp} pattern File name pattern with the number as group 1.
 * @returns {object[]}
 */
function readRound(dir, pattern) {
  return fs.readdirSync(dir).map(f => [f, pattern.exec(f)]).filter(([, m]) => m).sort((a, b) => Number(a[1][1]) - Number(b[1][1]))
    .flatMap(([f]) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function main(argv) {
  const i = argv.indexOf('--dir'), dir = i >= 0 ? argv[i + 1] : undefined;
  if (!dir) { console.error('usage: --dir <measurement folder>'); return 2; }
  let out;
  try {
    const sample = JSON.parse(fs.readFileSync(path.join(dir, 'sample.json'), 'utf8'));
    const r1 = readRound(dir, /^check-g(\d+)\.json$/), r2 = readRound(dir, /^recheck-r(\d+)\.json$/);
    if (!r1.length) throw new Error('no round-1 file check-g<n>.json');
    out = aggregate(sample, r1, r2);
  } catch (e) { console.error(e.message); return 1; }
  fs.writeFileSync(path.join(dir, 'ergebnis.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.gesamt));
  for (const t of [...out.liste, ...out.land]) console.log(JSON.stringify(t));
  console.log('controls', out.rows.filter(r => r.r1 === 'correct' && r.r2).map(r => r.id + ':' + r.r2).join(' '));
  console.log('disputed', out.rows.filter(r => r.final === 'disputed').map(r => r.id + ' ' + r.ticker + ' ' + r.field + ' ' + r.r1 + '/' + r.r2).join('; '));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { finalClass, wilson, aggregate, readRound, main };
