'use strict';

// "When issued" designates temporary pre-issuance trading, not another
// operating company. Word boundaries keep normal "issued shares" names valid.
const WHEN_ISSUED_RE = /\bwhen[\s-]+issued\b/i;

function isWhenIssuedSecurity(name) {
  return typeof name === 'string' && WHEN_ISSUED_RE.test(name);
}

module.exports = { isWhenIssuedSecurity, WHEN_ISSUED_RE };
