'use strict';
// P290: which listing represents an issuer. Claude and Codex agree on a fixed, evidenced home listing with an
// allowed fallback: the daily market-cap contest changed the shown listing of about 442 firms per data day
// (3,985 changes in ten data days, 947 firms) although two listings of one firm differ by under 1 % in most of them.
const fs = require('node:fs');
const path = require('node:path');
const { loadDupIssuerShadowTable } = require('./dup-issuer-shadow-table.js');
const { g31Shadow } = require('./g31-recency.js');

const TABLE_PATH = path.join(__dirname, '..', 'configs', 'home-listing.json');
const SOURCED_HOME = -1, NOT_HOME = 100, SECONDARY_BOARD = 101;

/**
 * Loads and validates the country table; a malformed table throws (fail loud, the run must not guess a listing).
 * @param {string} [file] Path of the table.
 * @returns {{exchanges: Map<string, string[]>, boards: Map<string, string>}} Exchanges per country; ticker prefix per mirror board.
 */
function loadHomeListingTable(file = TABLE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const suffix = /^\.[A-Z]+$/;
  const exchanges = new Map(), boards = new Map();
  for (const [country, row] of Object.entries(raw.exchangesByCountry || {})) {
    if (!Array.isArray(row) || !row.length || !row.every((s) => suffix.test(s))) throw new Error(`${file}: bad exchanges for ${country}`);
    exchanges.set(country, row);
  }
  for (const [s, row] of Object.entries(raw.secondaryBoards || {})) {
    if (!suffix.test(s) || !row || typeof row.tickerPrefix !== 'string') throw new Error(`${file}: bad secondary board ${s}`);
    boards.set(s, row.tickerPrefix);
  }
  if (!exchanges.size || !boards.size) throw new Error(`${file}: empty table`);
  return { exchanges, boards };
}

const { exchanges: EXCHANGES, boards: BOARDS } = loadHomeListingTable();
const SOURCED = new Set(Object.values(loadDupIssuerShadowTable()).map((row) => row.homeListingProposal).filter(Boolean));
const suffixOf = (ticker) => (String(ticker).match(/\.[A-Z]+$/) || [''])[0];

/**
 * Rank of a listing inside its issuer: a sourced row first, then the home exchanges of the issuer's country in their
 * fixed order, then any other exchange, last a board that only mirrors foreign shares.
 * @param {string} ticker Listing.
 * @param {?string} country meta.country of the listing (Yahoo's head office; the listings that reached the contest agreed on 31.10.2026).
 * @returns {number} Smaller is preferred; below NOT_HOME means a home listing.
 */
function homeListingRank(ticker, country) {
  if (SOURCED.has(ticker)) return SOURCED_HOME;
  const suffix = suffixOf(ticker);
  const position = (EXCHANGES.get(country) || []).indexOf(suffix);
  if (position >= 0) return position;
  // A home-country listing returned above, so a share on its own Vienna or Milan board never lands here.
  return BOARDS.has(suffix) && String(ticker).startsWith(BOARDS.get(suffix)) ? SECONDARY_BOARD : NOT_HOME;
}

/**
 * Newest month the board would show for this listing: the period of the growth figure, from the same function that labels it
 * (G31). Listings of one issuer are reloaded on different days, so they can differ (ASML on 31.10.2026: Milan to 30.09.2026,
 * Amsterdam to 30.06.2026). A quarter without its year-ago partner does not count, because the board cannot show it: BESI.VI
 * holds the September quarter but only reaches a growth figure for 2025. A revenue of 0 is vendor padding, no report (T2):
 * 3993.HK carries 0 for 2026-09-30 and would show -100 %. Month, not day: vendors stamp one fiscal period differently.
 * The older-pair walk of lib/g31-recency.js applies one exchange gate to every listing whose figures an exchange store proves
 * (Codex R23, finding 2: not the Yahoo country), so this month and the shown figure always read the same comparison.
 * @param {object} snapshot Prepared snapshot, or a slim one that already carries `shownGrowthMonth` (the Rule-of-40 writer holds no statements).
 * @returns {string} 'YYYY-MM', or '' when the listing has no labelled growth figure.
 */
function shownGrowthMonth(snapshot) {
  if (typeof (snapshot && snapshot.shownGrowthMonth) === 'string') return snapshot.shownGrowthMonth;
  const leg = g31Shadow(snapshot).v1;
  return leg.periodEnd && leg.current > 0 ? leg.periodEnd.slice(0, 7) : '';
}

// The rank gate of scripts/write-findash-export.js (rangGrund), kept here once so that the issuer dedup asks the same question.
const RANK_MIN_AXES = 4, RANK_GATE_MIN_NENNER = 7;
/**
 * Whether n covered of m weighted axes may hold a rank; formulas below 7 weighted axes are never gated.
 * @param {number} n Covered weighted axes.
 * @param {number} m Weighted axes of the formula on the track.
 * @returns {boolean} True when the export's coverage gate lets the row hold a rank.
 */
function rankCapable(n, m) {
  return !(m >= RANK_GATE_MIN_NENNER && n < RANK_MIN_AXES);
}

/**
 * Whether the table names a home exchange for this country at all.
 * @param {?string} country meta.country.
 * @returns {boolean} False: among equal periods the listings of such a firm go by market cap, mirror boards last, with no home to name.
 */
const hasHomeExchange = (country) => EXCHANGES.has(country);

module.exports = { loadHomeListingTable, homeListingRank, shownGrowthMonth, hasHomeExchange, rankCapable, RANK_MIN_AXES, RANK_GATE_MIN_NENNER, NOT_HOME, SECONDARY_BOARD, SOURCED_HOME };
