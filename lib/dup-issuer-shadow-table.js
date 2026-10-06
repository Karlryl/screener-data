'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TABLE_PATH = path.join(__dirname, '..', 'configs', 'dup-issuer-shadow-table.json');
const BASIS = 'hand-table:dup-issuer-shadow';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

// Reports only: codeKeeps is the recorded production choice, never a primary-listing decision.
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

function secondaryIndex(table) {
  const index = new Map();
  for (const row of Object.values(table)) {
    for (const ticker of row.tickers) {
      if (ticker !== row.codeKeeps) index.set(ticker, {
        of: row.codeKeeps, issuer: row.issuer, homeListingProposal: row.homeListingProposal,
      });
    }
  }
  return index;
}

function applyDupIssuerShadow(row, index) {
  const secondary = index.get(row.ticker);
  if (secondary) row.dupIssuer = { of: secondary.of, issuer: secondary.issuer, basis: BASIS };
  return row;
}

module.exports = { loadDupIssuerShadowTable, secondaryIndex, applyDupIssuerShadow };
