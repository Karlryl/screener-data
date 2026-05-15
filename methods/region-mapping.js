'use strict';
/**
 * Tag 167: Exchange → Region mapping for regional method calibration.
 * Region groups: US, EU, APAC, EM, OTHER (fallback).
 *
 * Without this, methods use global sector medians and produce false-negatives
 * for international stocks (Japanese manufacturers fail "Rule of 40" thresholds
 * calibrated on US SaaS even when regionally healthy).
 *
 * Priority chain inside getRegion():
 *   1. stock.meta.region (future schema explicit override)
 *   2. stock.meta.exchange code (most reliable)
 *   3. stock.price.currency or stock.meta.currency (fallback for ambiguous exchanges)
 *   4. 'OTHER' sentinel
 */

const EXCHANGE_TO_REGION = {
  // US — major + OTC
  'NMS': 'US', 'NYQ': 'US', 'PCX': 'US', 'ASE': 'US', 'NGM': 'US',
  'NCM': 'US', 'NAS': 'US', 'NYS': 'US', 'AMX': 'US',
  'OTC': 'US', 'PNK': 'US', 'OBB': 'US', 'OQB': 'US', 'OQX': 'US',
  // Canada (grouped with US — similar accounting standards)
  'TOR': 'US', 'VAN': 'US', 'CNQ': 'US', 'NEO': 'US',
  // EU — major exchanges
  'GER': 'EU', 'FRA': 'EU', 'MUN': 'EU', 'STU': 'EU', 'DUS': 'EU', 'HAM': 'EU',
  'LSE': 'EU', 'IOB': 'EU',
  'PAR': 'EU', 'BRU': 'EU', 'AMS': 'EU', 'EBS': 'EU', 'SWX': 'EU',
  'MIL': 'EU', 'MCE': 'EU', 'LIS': 'EU', 'VIE': 'EU',
  'STO': 'EU', 'HEL': 'EU', 'CPH': 'EU', 'OSL': 'EU', 'ICE': 'EU',
  'WAR': 'EU', 'PRA': 'EU', 'BUD': 'EU',
  // APAC
  'TYO': 'APAC', 'JPX': 'APAC',
  'HKG': 'APAC', 'SHH': 'APAC', 'SHZ': 'APAC',
  'KOE': 'APAC', 'KSC': 'APAC', 'KOSDAQ': 'APAC',
  'ASX': 'APAC', 'NZE': 'APAC',
  'SGX': 'APAC', 'TAI': 'APAC', 'TWO': 'APAC',
  // EM
  'BSE': 'EM', 'NSI': 'EM', 'IND': 'EM',
  'SAO': 'EM', 'BVMF': 'EM',
  'MEX': 'EM', 'MEXICO': 'EM',
  'JNB': 'EM', 'JSE': 'EM',
  'IST': 'EM', 'BIST': 'EM',
  'MIC': 'EM', 'MCX': 'EM',
};

// Currency-based fallback when exchange is ambiguous or unknown
const CURRENCY_TO_REGION_FALLBACK = {
  'USD': 'US', 'CAD': 'US',
  'EUR': 'EU', 'GBP': 'EU', 'CHF': 'EU', 'SEK': 'EU', 'NOK': 'EU',
  'DKK': 'EU', 'PLN': 'EU', 'CZK': 'EU', 'HUF': 'EU',
  'JPY': 'APAC', 'HKD': 'APAC', 'CNY': 'APAC', 'KRW': 'APAC',
  'AUD': 'APAC', 'NZD': 'APAC', 'SGD': 'APAC', 'TWD': 'APAC',
  'INR': 'EM', 'BRL': 'EM', 'MXN': 'EM', 'ZAR': 'EM', 'TRY': 'EM', 'RUB': 'EM',
};

// F-ME-018: stock.meta.region may contain exchange display names (e.g., 'Nasdaq', 'NYSE')
// rather than region buckets ('US', 'EU'). Normalize them here.
const DISPLAY_NAME_TO_REGION = {
  'Nasdaq': 'US', 'NasdaqCM': 'US', 'NasdaqGM': 'US', 'NasdaqGS': 'US',
  'NYSE': 'US', 'NYSE American': 'US', 'NYSEArca': 'US', 'NYSE MKT': 'US',
  'NASDAQ': 'US', 'AMEX': 'US', 'Cboe US': 'US',
  'OTC Markets OTCPK': 'US', 'OTC Markets OTCQX': 'US',
  'XETRA': 'EU', 'Frankfurt': 'EU', 'LSE': 'EU',
  'Toronto': 'US', 'HKSE': 'APAC', 'ASX': 'APAC', 'Tokyo': 'APAC',
  'Shanghai': 'APAC', 'Shenzhen': 'APAC', 'KSE': 'APAC', 'KOSDAQ': 'APAC',
};

/**
 * Resolve the region for a stock object.
 * @param {object} stock — canonical stock object
 * @returns {string} one of 'US', 'EU', 'APAC', 'EM', 'OTHER'
 */
function getRegion(stock) {
  if (!stock) return 'OTHER';

  // Priority 1: explicit meta.region — but first normalize exchange display names to region buckets
  const explicitRegion = stock.meta && stock.meta.region;
  if (explicitRegion) {
    // If it looks like a valid region bucket already, return it
    if (explicitRegion === 'US' || explicitRegion === 'EU' || explicitRegion === 'APAC' || explicitRegion === 'EM' || explicitRegion === 'OTHER') {
      return explicitRegion;
    }
    // Otherwise try to map from display name to region bucket
    if (DISPLAY_NAME_TO_REGION[explicitRegion]) return DISPLAY_NAME_TO_REGION[explicitRegion];
    // Unknown value — fall through to exchange lookup rather than returning a bad bucket
  }

  // Priority 2: exchange code
  const exchange = stock.meta && stock.meta.exchange;
  if (exchange && EXCHANGE_TO_REGION[exchange]) return EXCHANGE_TO_REGION[exchange];

  // Priority 3: currency
  const currency = (stock.price && stock.price.currency) || (stock.meta && stock.meta.currency);
  if (currency && CURRENCY_TO_REGION_FALLBACK[currency]) return CURRENCY_TO_REGION_FALLBACK[currency];

  // Priority 4: fallback
  return 'OTHER';
}

module.exports = { getRegion, EXCHANGE_TO_REGION, CURRENCY_TO_REGION_FALLBACK };
