'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TABLE_PATH = path.join(__dirname, '..', 'configs', 'dup-issuer-shadow-table.json');
const BASIS = 'hand-table:dup-issuer-shadow';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

// Reports only: codeKeeps is the recorded production choice, never a primary-listing decision.
/**
 * Loads and validates the shadow hand table; any malformed row throws (fail loud).
 * @param {string} [file] Path to the table JSON (default configs/dup-issuer-shadow-table.json).
 * @returns {Object<string, object>} Rows keyed by issuer slug ('_'-prefixed keys skipped).
 */
function loadDupIssuerShadowTable(file = TABLE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isObject(raw)) throw new Error(`${file}: root must be an object of rows`);
  const rows = {};
  const seen = new Set();
  for (const [id, row] of Object.entries(raw)) {
    if (id.startsWith('_')) continue;
    const bad = (why) => { throw new Error(`${file}: row ${id}: ${why}`); };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) bad('issuer id must be a lower-case slug');
    if (!isObject(row)) bad('not an object');
    if (!isText(row.issuer)) bad('issuer missing');
    if (!Array.isArray(row.tickers) || !row.tickers.length || !row.tickers.every(isText)) bad('tickers must be a non-empty list of strings');
    if (!row.tickers.includes(row.codeKeeps)) bad('codeKeeps must be in tickers');
    if (row.homeListingProposal !== null && !row.tickers.includes(row.homeListingProposal)) bad('homeListingProposal must be null or in tickers');
    if (row.markFollowsHomeListing !== undefined && (row.markFollowsHomeListing !== true || row.homeListingProposal === null)) {
      bad('markFollowsHomeListing must be true and needs a homeListingProposal');
    }
    const source = row.source;
    if (!isObject(source) || !isText(source.url) || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(source.url) || !isText(source.quote)) bad('source needs url and quote');
    for (const field of ['sourceCheckedOn', 'enteredOn']) {
      if (typeof row[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row[field]) ||
          !Number.isFinite(Date.parse(row[field])) || new Date(row[field]).toISOString().slice(0, 10) !== row[field]) bad(`${field} must be an ISO day`);
    }
    if (!isText(row.note)) bad('note missing');
    for (const ticker of row.tickers) {
      if (ticker !== ticker.trim()) bad('ticker has surrounding whitespace');
      if (seen.has(ticker)) bad(`duplicate ticker ${ticker}`);
      seen.add(ticker);
    }
    rows[id] = row;
  }
  return rows;
}

// Brief sd-dup (master decision 18.10.2026): a row with markFollowsHomeListing (Copel, AXIA, whose
// recorded codeKeeps is the non-home ADR) marks every ticker except its home listing. All other rows
// keep codeKeeps; Kloeckner deliberately keeps it too (listed in the PR, own decision).
/**
 * Kept (unmarked) ticker of a validated hand-table row.
 * @param {object} row One validated row from loadDupIssuerShadowTable().
 * @returns {string} homeListingProposal when markFollowsHomeListing is set, otherwise codeKeeps.
 */
function markKeeps(row) {
  return row.markFollowsHomeListing === true ? row.homeListingProposal : row.codeKeeps;
}

/**
 * Maps every listed secondary ticker to its kept ticker and issuer.
 * @param {Object<string, object>} table Validated rows from loadDupIssuerShadowTable().
 * @returns {Map<string, {of: string, issuer: string, homeListingProposal: string|null}>} Secondary ticker index.
 */
function secondaryIndex(table) {
  const index = new Map();
  for (const row of Object.values(table)) {
    const kept = markKeeps(row);
    for (const ticker of row.tickers) {
      if (ticker !== kept) index.set(ticker, {
        of: kept, issuer: row.issuer, homeListingProposal: row.homeListingProposal,
      });
    }
  }
  return index;
}

/**
 * Adds the dupIssuer marker to a listed secondary row; every other row stays untouched.
 * @param {object} row Export row with a ticker.
 * @param {Map<string, {of: string, issuer: string}>} index Result of secondaryIndex().
 * @returns {object} The same row (mutated only when its ticker is a listed secondary).
 */
function applyDupIssuerShadow(row, index) {
  const secondary = index.get(row.ticker);
  if (secondary) row.dupIssuer = { of: secondary.of, issuer: secondary.issuer, basis: BASIS };
  return row;
}

// Brief sd-dup (18.10.2026, master decision): the sourced homeListingProposal is the primary
// listing, independent of where the dupIssuer marker sits (Copel and AXIA carry it on the non-home
// row, Kloeckner on its home row KCO.DE). Issuers with an open proposal (null) are not in this index and keep every rank.
/**
 * Maps every non-home ticker of an issuer with a home-listing proposal to that home ticker.
 * @param {Object<string, object>} table Validated rows from loadDupIssuerShadowTable().
 * @returns {Map<string, string>} Non-home ticker -> home ticker.
 */
function homeListingIndex(table) {
  const index = new Map();
  for (const row of Object.values(table)) {
    if (row.homeListingProposal === null) continue;
    for (const ticker of row.tickers) if (ticker !== row.homeListingProposal) index.set(ticker, row.homeListingProposal);
  }
  return index;
}

/**
 * Rank reason for a non-home listing whose home listing stands in the same ranking (no firm twice).
 * A non-home listing alone keeps its rank, otherwise the firm would vanish from the ranking.
 * @param {string} ticker Export ticker.
 * @param {Map<string, string>} index Result of homeListingIndex().
 * @param {Set<string>} ranking Tickers of the whole ranking (full cohort of the list's track).
 * @returns {'dupIssuer'|null} 'dupIssuer' when the row must not hold a rank, otherwise null.
 */
function dupIssuerRankGrund(ticker, index, ranking) {
  const home = index.get(ticker);
  return home !== undefined && ranking.has(home) ? 'dupIssuer' : null;
}

module.exports = { loadDupIssuerShadowTable, markKeeps, secondaryIndex, applyDupIssuerShadow, homeListingIndex, dupIssuerRankGrund };
