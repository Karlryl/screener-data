#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const DAY = 86400000;

// Load only the diagnostic declarations, never the pull module's initialization
// (environment, dependencies, local configuration). No copied fundamentals reader.
// SELECTOR_COUNTERS is canonical but is not exported by the merge module.
function loadHelpers(io = fs) {
  const merge = fs.readFileSync(path.join(__dirname, 'merge-shard-manifests.js'), 'utf8');
  const declaration = merge.match(/const SELECTOR_COUNTERS = (\[[\s\S]*?\]);/);
  if (!declaration) throw new Error('Kanonische SELECTOR_COUNTERS-Deklaration fehlt');
  const names = [...vm.runInNewContext(declaration[1])];
  if (names.length !== 4 || names.some(n => typeof n !== 'string')) {
    throw new Error('Unbekannter Selektor-Vertrag');
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const functions = ['fundamentalsStaleness', 'fundamentalsAsOfAgeFromFile', 'readFileHead', 'selectorBucket'];
  const definitions = functions.map(name => {
    const match = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'));
    if (!match) throw new Error(`Diagnose-Funktion fehlt: ${name}`);
    return match[0];
  });
  const helpers = vm.runInNewContext(`${definitions.join('\n')}\n;({${functions.join(',')}})`, {
    fs: io, Buffer, FUNDAMENTALS_MAX_AGE_MS: 7 * DAY, FUNDAMENTALS_REFRESH_MS: 30 * DAY,
  });
  return { ...helpers, names };
}

function readCounters(manifest, names) {
  return names.map(name => {
    if (!Object.hasOwn(manifest, name)) return null;
    const value = manifest[name];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Ungueltiger Zaehler: ${name}`);
    return value;
  });
}

function verdict(counters, population, manifest = {}) {
  if (counters.some(value => value === null)) return 'nicht entscheidbar: Manifest ohne Selektor-Zähler';
  if (manifest.partial === true) return 'nicht entscheidbar: unvollständiger Lauf';
  if (counters[1] > counters[0]) return 'nicht entscheidbar: widersprüchliche Selektor-Zähler';
  if (population) {
    if (!population.snapshots || population.invalid) return 'nicht entscheidbar: leere oder beschädigte Population';
    if (population.counters.some((n, i) => n !== counters[i])) {
      return 'die beiden Messungen messen nicht dasselbe';
    }
  }
  // Explicit reading convention, not a fitted threshold or a causal proof:
  // "near" = within a factor of two; "large" = at least half of 8750.
  const youngStale = counters[1];
  if (youngStale >= 4375 && youngStale <= 17500) return 'Tor bremst nicht';
  if (youngStale >= 67.5 && youngStale <= 270 && counters[2] >= 4375) return 'Tor bremst';
  return 'nicht entscheidbar: kein eindeutiges Urteil';
}

function scanPopulation(directory, now, helpers, io = fs) {
  const result = { files: 0, snapshots: 0, metadata: 0, invalid: 0, known: 0, stale: 0,
    counters: [0, 0, 0, 0], ages: [0, 0, 0, 0, 0, 0, 0], none: 0, oldFresh: 0,
    youngClockStale: 0, youngRuleOnly: 0, youngIncomplete: 0, duplicates: 0 };
  const tickers = new Set();
  function walk(dir) {
    for (const entry of io.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolischer Link nicht erlaubt: ${file}`);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      result.files++;
      let snapshot;
      try { snapshot = JSON.parse(io.readFileSync(file, 'utf8')); }
      catch { result.invalid++; continue; }
      // Identify stock snapshots by content; sidecars do not enter the denominator.
      if (!snapshot?.meta || typeof snapshot.meta.ticker !== 'string' || !snapshot.meta.ticker) {
        result.metadata++; continue;
      }
      result.snapshots++;
      if (tickers.has(snapshot.meta.ticker)) result.duplicates++;
      tickers.add(snapshot.meta.ticker);
      const fundamentalAge = helpers.fundamentalsAsOfAgeFromFile(file, now);
      if (fundamentalAge === null) result.ages[6]++;
      else {
        result.known++;
        const index = fundamentalAge < 0 ? 0 : fundamentalAge <= 7 * DAY ? 1
          : fundamentalAge <= 30 * DAY ? 2 : fundamentalAge <= 60 * DAY ? 3
            : fundamentalAge <= 90 * DAY ? 4 : 5;
        result.ages[index]++;
        if (fundamentalAge > 30 * DAY) result.stale++;
      }
      // Same 500-byte asOf input as _getExistingSnapshotAge, pull-yahoo.js:3322.
      const match = helpers.readFileHead(file, 500)?.match(/"asOf"\s*:\s*"([^"]+)"/);
      const timestamp = match ? Date.parse(match[1]) : NaN;
      const age = Number.isFinite(timestamp) ? now - timestamp : null;
      const bucket = helpers.selectorBucket(age, fundamentalAge, 7 * DAY, 30 * DAY);
      if (bucket === 'young') {
        result.counters[0]++;
        if (fundamentalAge !== null && fundamentalAge > 30 * DAY) result.youngClockStale++;
        // selectorBucket returns 'young', not its stale subset. Use the SAME
        // production predicate that increments _selYoungAndStale (line 3668).
        if (helpers.fundamentalsStaleness(snapshot.meta, now).stale) {
          result.counters[1]++;
          if (snapshot.meta.fundamentalsIncomplete === true) result.youngIncomplete++;
          if (fundamentalAge === null || fundamentalAge <= 30 * DAY) result.youngRuleOnly++;
        }
      } else if (bucket === 'overdue') result.counters[2]++;
      else if (bucket === 'unknown') result.counters[3]++;
      else if (bucket === 'none') result.none++;
      else result.oldFresh++;
    }
  }
  walk(directory);
  return result;
}

function report(manifest, population, helpers) {
  const counters = readCounters(manifest, helpers.names);
  const lines = helpers.names.map((name, i) => `${name}: ${counters[i] === null
    ? 'nicht vorhanden (Manifest älter als #323)' : counters[i]}`);
  lines.push('Abgleich: feste Schwellen asOf < 7 Tage, fundamentalsAsOf > 30 Tage; keine Umgebungsvariablen.');
  lines.push('CI-Schwellen sind im Manifest nicht belegt; Nachrechnung am pulled_at-Zeitpunkt, kein Replay des Eingangsbestands.');
  if (population) {
    const p = population;
    lines.push(`Stichtag: ${manifest.pulled_at}`);
    lines.push(`Population: ${p.snapshots} Snapshot-Dateien; ${p.metadata} Metadaten; ${p.invalid} unlesbar; ${p.duplicates} doppelte Ticker (Dateien separat gezählt).`);
    const share = p.known ? (100 * p.stale / p.known).toFixed(2) : 'nicht bestimmbar';
    lines.push(`Veraltet (>30 Tage): ${p.stale}/${p.known} lesbare fundamentalsAsOf = ${share} %; unbekannt: ${p.ages[6]}.`);
    lines.push(`Altersverteilung [Zukunft, 0–7d, >7–30d, >30–60d, >60–90d, >90d, unbekannt]: ${p.ages.join(' / ')}.`);
    helpers.names.forEach((name, i) => lines.push(`Nachrechnung ${name}: ${p.counters[i]}; Manifest: ${counters[i] === null ? 'nicht vorhanden' : counters[i]}; Delta: ${counters[i] === null ? 'nicht bestimmbar' : p.counters[i] - counters[i]}.`));
    lines.push(`Außerhalb der vier Zähler: asOf nicht lesbar ${p.none}; alte asOf mit frischer Fundamentaluhr ${p.oldFresh}. Der zweite Zähler ist eine Teilmenge des ersten.`);
    lines.push(`Jung und Uhr >30d: ${p.youngClockStale}; zusätzlich nach meta-Regel veraltet: ${p.youngRuleOnly}.`);
    lines.push(`Jung und fundamentalsIncomplete=true: ${p.youngIncomplete} (fundamentalsStaleness, pull-yahoo.js:293: unabhängig vom Alter veraltet).`);
    if (p.known && Math.abs(p.stale / p.known - 8750 / 15040) > 0.1) {
      lines.push('ABWEICHUNG zur Referenz 8750/15040 (58,2 %): im übergebenen Bestand nicht reproduziert; Herkunft der Referenz hier nicht belegt.');
    }
    if (counters.every(n => n !== null) && p.counters.some((n, i) => n !== counters[i])) {
      lines.push('Die Manifest-Zahl ist nicht über diese Population zu diesem Stichtag mit diesen Regeln gerechnet.');
    }
    lines.push('Quellbeleg pull-yahoo.js:308–359: Kopf-Uhr fundamentalsAsOf (4096 Bytes), selectorBucket nutzt zuerst asOf <7d; jenseits davon fundamentalsAsOf >30d.');
    lines.push('Quellbeleg pull-yahoo.js:3322–3333, 3604–3669: Manifest zählt in processOne vor dem Abruf; junge Veraltete über fundamentalsStaleness(meta), mit fundamentalsIncomplete, fetchedAt-Fallback und unlesbaren Uhren. Dateibestand zählt dagegen alle gelieferten Snapshots nach dem Lauf.');
    lines.push('Belegt sind unterschiedliche Messumfänge/-zeitpunkte und Regeln, nicht die konkrete Vorfilter-Ursache einzelner fehlender Ticker; Watchlist und Eingangsbestand fehlen.');
  } else lines.push('Veraltungs-Anteil: nicht berechnet (kein Snapshot-Verzeichnis).');
  if (counters[1] !== null) lines.push(`Abstände n_sel_young_and_stale: zu 8750 = ${Math.abs(counters[1] - 8750)}; zu 135 = ${Math.abs(counters[1] - 135)}.`);
  lines.push('Lesekonvention: nahe = Faktor 2; groß = mindestens 4375. Tor-Urteile nach Lesehilfe, kein kausaler Nachweis.');
  lines.push(`Urteil: ${verdict(counters, population, manifest)}`);
  return lines.join('\n');
}

function main(args, { io = fs, write = console.log, error = console.error } = {}) {
  try {
    if (args.length < 1 || args.length > 2) throw new Error('Aufruf: node scripts/durchsatz-lesehilfe.js <manifest.json> [<snapshot-verzeichnis>]');
    const manifest = JSON.parse(io.readFileSync(args[0], 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifest muss ein Objekt sein');
    const helpers = loadHelpers(io);
    readCounters(manifest, helpers.names);
    let population;
    if (args[1]) {
      const now = typeof manifest.pulled_at === 'string' ? Date.parse(manifest.pulled_at) : NaN;
      if (!Number.isFinite(now)) throw new Error('Snapshot-Abgleich braucht ein gültiges pulled_at im Manifest');
      population = scanPopulation(args[1], now, helpers, io);
    }
    write(report(manifest, population, helpers));
    return 0;
  } catch (err) {
    error(`Fehler: ${err.message}`);
    return 1;
  }
}

module.exports = { loadHelpers, readCounters, verdict, scanPopulation, report, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
