#!/usr/bin/env node
'use strict';
const path = require('node:path');
const W = require('./watch-annual-spikes.js');
const { writeFileAtomic } = require('../lib/atomic-write.js');

function triple(key) {
  const p = key.split('|');
  if (p.length !== 5 || !p[2].startsWith('werte:')) return null;
  const values = [p[2].slice(6), p[3], p[4]];
  return values.every(v => v.trim() !== '' && Number.isFinite(Number(v))) ? values.map(Number) : null;
}

function proportional(old, current) {
  if (!old || old[1] === 0) return null;
  const factor = current[1] / old[1];
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const errors = old.map((v, i) => v === 0 ? (current[i] === 0 ? 0 : Infinity)
    : Math.abs(current[i] / (v * factor) - 1));
  const error = Math.max(...errors);
  return error <= 1e-9 ? { factor, error } : null;
}

function candidate(key, x, basis, funde) {
  const old = triple(key), current = [x.links, x.wert, x.rechts];
  const ratio = proportional(old, current);
  const result = { fund: W.sperrSchluessel(x), faktor: ratio?.factor ?? null,
    abweichung: ratio?.error ?? null };
  const reject = grund => ({ ...result, grund, geeignet: false });
  if (W.istEichfall(x)) return reject('calibration-only');
  if ((basis.ausgeschlossen || []).some(a => a.sperrschluessel === result.fund)) return reject('excluded');
  if (!ratio) return reject('non-proportional-or-no-usd-triple');
  if (!W.nativerSchluessel(x)) return reject('missing-native-or-fx');
  if (x.nativ.waehrung === 'USD' && Math.abs(ratio.factor - 1) > 1e-9) return reject('usd-has-no-fx-drift');
  if (x.reihe === 'annualOpInc' && x.opIncSource === 'computed-margin') {
    const rev = x.nativ.periode && funde.find(f => f.ticker === x.ticker && f.reihe === 'annualRev'
      && f.nativ?.periode === x.nativ.periode);
    const revKeys = basis.faelle.filter(k => k.startsWith(`${x.ticker}|annualRev|`));
    // A uniformly revised computed margin also scales a whole triple; require unchanged margins.
    const unchanged = rev && revKeys.some(k => {
      const oldRev = triple(k), nowRev = [rev.links, rev.wert, rev.rechts];
      const revRatio = proportional(oldRev, nowRev);
      return revRatio && Math.abs(ratio.factor / revRatio.factor - 1) <= 1e-9
        && old.every((v, i) => oldRev[i] === 0 ? v === 0 && current[i] === 0 && nowRev[i] === 0
          : v === 0 ? current[i] === 0
            : Math.abs((current[i] / nowRev[i]) / (v / oldRev[i]) - 1) <= 1e-9);
    });
    if (!unchanged) return reject('computed-margin-changed-or-unproven');
  }
  return { ...result, geeignet: true, grund: 'proportional-native-match' };
}

/**
 * Add native identities only to existing, uniquely matched baseline entries.
 * @param {object} basis Existing baseline; never mutated.
 * @param {object} scan Result of the watcher's snapshot scan.
 * @param {string} datenstand Snapshot artifact date (YYYY-MM-DD).
 * @returns {object} Baseline plus the decision for each old key; no disk writes.
 */
function migriereIdentitaeten(basis, scan, datenstand) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datenstand || '') || !Number.isFinite(Date.parse(datenstand))
    || new Date(datenstand).toISOString().slice(0, 10) !== datenstand) throw new Error('Invalid data date');
  if (!Array.isArray(basis.faelle) || scan.parseFehler || !scan.gescannt) throw new Error('Incomplete migration input');
  const valid = W.basisGueltig(basis, scan.gescannt);
  if (!valid.ok) throw new Error(valid.grund);
  W.pruefeAusschluesse(basis);
  const native = [...(basis.nativeIdentitaeten || [])];
  const vorhanden = new Set(native.map(a => a.schluessel));
  const entscheidungen = [];
  for (const key of basis.faelle) {
    const [ticker, reihe] = key.split('|');
    if (vorhanden.has(key)) {
      entscheidungen.push({ schluessel: key, grund: 'already-migrated', kandidaten: [] });
      continue;
    }
    const funde = scan.funde.filter(x => x.ticker === ticker && x.reihe === reihe);
    const kandidaten = funde.map(x => candidate(key, x, basis, scan.funde));
    const eligible = kandidaten.filter(k => k.geeignet);
    const grund = eligible.length === 1 ? 'migrated' : eligible.length > 1 ? 'ambiguous-period'
      : kandidaten[0]?.grund || 'absent-today';
    entscheidungen.push({ schluessel: key, grund, kandidaten });
    if (eligible.length !== 1) continue;
    const match = eligible[0], x = funde.find(f => W.sperrSchluessel(f) === match.fund);
    native.push({ schluessel: key, ticker, reihe, nativ: x.nativ, datenstand,
      fxRateApplied: x.fxRateApplied, usdFaktor: match.faktor, maxRelativeAbweichung: match.abweichung });
    vorhanden.add(key);
  }
  native.sort((a, b) => a.schluessel < b.schluessel ? -1 : a.schluessel > b.schluessel ? 1 : 0);
  return { baseline: native.length ? { ...basis, nativeIdentitaeten: native } : { ...basis }, entscheidungen };
}

module.exports = { migriereIdentitaeten };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if ((args.length !== 2 && args.length !== 3) || (args.length === 3 && args[2] !== '--write')
      || !path.isAbsolute(args[0])) throw new Error('Usage: node scripts/annual-spikes-migrate-identity.js <absolute-snapshots-dir> <YYYY-MM-DD> [--write]');
    const file = path.join(__dirname, '..', 'data-health', 'annual-spikes-baseline.json');
    const basis = W.loadBaseline(file);
    const result = migriereIdentitaeten(basis, W.scanSnapshots(args[0]), args[1]);
    if (args[2] === '--write' && JSON.stringify(result.baseline) !== JSON.stringify(basis)) {
      writeFileAtomic(file, JSON.stringify(result.baseline, null, 1) + '\n', 'utf8');
    }
    const count = result.entscheidungen.filter(x => x.grund === 'migrated').length;
    console.log(JSON.stringify({ migrated: count, unchanged: basis.faelle.length - count,
      nativeIdentities: new Set((result.baseline.nativeIdentitaeten || []).map(W.nativerSchluessel)).size,
      written: args[2] === '--write' && count > 0 }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
