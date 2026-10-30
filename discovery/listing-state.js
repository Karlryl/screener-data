'use strict';

// Listing lifecycle evidence is separate from scoring exclusions and vendor availability.
const fs = require('node:fs');
const path = require('node:path');
const LISTING_EXITS_FILE = '_manifest-listing-exits.json';

function readIntakeLog(file, readFile = fs.readFileSync) {
  try {
    const log = JSON.parse(readFile(file, 'utf8'));
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw new Error('Invalid intake log');
    return log;
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

function retryCandidates(registry, log, stocks) {
  const present = new Set(stocks.map(r => r && r.ticker).filter(Boolean));
  const w7 = registry.w7_2026_10_30 || {};
  const pending = new Map();
  for (const [ticker, row] of Object.entries(w7.provisional || {})) {
    pending.set(ticker, { ticker, source: 'w7-wiedervorlage', ...row.kandidat });
  }
  const gate = log.tor3_aufnahmeQuote || {};
  for (const row of gate.wiedervorlage || gate.abgelehnt || []) {
    pending.set(row.ticker, { ticker: row.ticker, source: row.quelle || 'w7-wiedervorlage', ...row.kandidat });
  }
  return [...pending.values()].filter(r => !present.has(r.ticker)
    && !(registry.tickers || {})[r.ticker] && !(w7.mappings || {})[r.ticker]);
}

function mapListingCandidates(candidates, registry) {
  const mappings = (registry.w7_2026_10_30 || {}).mappings || {};
  const mapped = new Map();
  for (const row of candidates) {
    const target = mappings[row.ticker];
    const ticker = target ? target.nachfolger : row.ticker;
    // Prefer the correctly named discovery row over a repaired alias.
    if (!mapped.has(ticker) || !target) mapped.set(ticker, { ...row, ticker });
  }
  return [...mapped.values()];
}

function intakeCandidates(discovered, retries, existing) {
  // Saved retries must be asked even when the raw candidate cap dropped them.
  return [...new Map([...retries, ...discovered].map(row => [row.ticker, row])).values()]
    .filter(row => !existing.has(row.ticker));
}

function planListingExits(stocks, registry, date) {
  const w7 = registry.w7_2026_10_30 || {};
  const mappings = w7.mappings || {};
  const survivors = [];
  const present = new Set(stocks.map(row => row && row.ticker).filter(Boolean));
  const exits = [];
  for (const row of stocks) {
    const ticker = row && row.ticker;
    const mapping = mappings[ticker];
    if (ticker && ((registry.tickers || {})[ticker] || mapping)) {
      const evidence = mapping || (w7.confirmed || {})[ticker];
      exits.push({ ticker, name: row.name || null, datum: date,
        grund: evidence ? evidence.grund : registry.tickers[ticker],
        quelle: evidence ? evidence.quelle : 'data-health/dead-tickers.json',
        nachfolger: evidence ? evidence.nachfolger || null : null,
        status: mapping ? 'zuordnung-korrigiert' : evidence ? 'bestaetigt' : 'altbestand',
        ...(evidence ? { belegDatum: evidence.datum } : { hinweis: 'Alter Registry-Eintrag. Der Anbieterbefund allein belegt kein Delisting.' }),
      });
      if (mapping && !present.has(mapping.nachfolger)) {
        survivors.push({ ...row, ticker: mapping.nachfolger, yahoo_symbol: mapping.nachfolger });
        present.add(mapping.nachfolger);
      }
    } else survivors.push(row);
  }
  return { stocks: survivors, exits };
}

function mergeListingExits(previous, current) {
  const rows = new Map();
  for (const row of [...previous, ...current]) {
    if (!row || !row.ticker || !/^\d{4}-\d{2}-\d{2}$/.test(row.datum || '') || !row.grund || !row.quelle) {
      throw new Error('Unvollstaendiger Notierungsabgang im Aufnahmeprotokoll.');
    }
    rows.set(row.ticker, row);
  }
  return [...rows.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function deliveredListingExits(log, stocks) {
  const present = new Set(stocks.map(row => row && row.ticker).filter(Boolean));
  return mergeListingExits(log.listingExits || [], []).filter(row => !present.has(row.ticker))
    .map(row => ({ ...row, date: row.datum, reason: row.grund, source: row.quelle, successor: row.nachfolger || null }));
}

function writeListingExitManifest(logFile, stocks, targetDir, runDate, writeFile, readLog = readIntakeLog) {
  const log = readLog(logFile);
  const manifest = { schema: 'listing-exits/v1', runDate, listingExits: deliveredListingExits(log, stocks) };
  writeFile(path.join(targetDir, LISTING_EXITS_FILE), JSON.stringify(manifest));
  return manifest;
}

function readListingExitManifest(file, readFile = fs.readFileSync) {
  const manifest = JSON.parse(readFile(file, 'utf8'));
  if (!manifest || manifest.schema !== 'listing-exits/v1' || !Array.isArray(manifest.listingExits)
    || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.runDate || '')) {
    throw new Error('Ungueltiger Notierungsabgang im Snapshot-Artefakt.');
  }
  return deliveredListingExits(manifest, []);
}

module.exports = { readIntakeLog, retryCandidates, mapListingCandidates, planListingExits,
  mergeListingExits, deliveredListingExits, intakeCandidates, writeListingExitManifest,
  readListingExitManifest, LISTING_EXITS_FILE };
