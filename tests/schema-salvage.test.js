// Task 0.13 (Tag 288) — Schema-Salvage für falsch-negative Validator-Rejects.
// Pinnt beides: (a) ein Adyen-förmiger Reject (Fehler NUR in earningsHistory,
// Pflichtfelder intakt) wird gerettet; (b) ein absichtlich verstümmelter Payload
// (Fehler außerhalb der Enrichment-Module ODER Kurs/Währung fehlt) bleibt ein Fail.
// No framework: assert, process.exit(fail?1:0). Run: node tests/schema-salvage.test.js
const assert = require('assert');
const { salvageValidationReject } = require('../pull-yahoo.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// Fixture-Bau: exakt die Error-Form, die yahoo-finance2 v3.14 wirft
// (FailedYahooValidationError mit {result, errors}; errors nach aggregateErrors).
function mkErr(errors, result) {
  const e = new Error('Failed Yahoo Schema validation');
  e.name = 'FailedYahooValidationError';
  e.result = result;
  e.errors = errors;
  return e;
}
// Wörtlich beobachteter Fehler (ADYEN.AS, Probe 2026-07-10):
const EH_MISSING = {
  schemaPath: '#/definitions/QuoteSummaryResult/items/required',
  instancePath: '/earningsHistory/history/0',
  message: 'Missing required properties',
  params: { missing: ['epsActual', 'epsDifference', 'surprisePercent'] }
};
function goodResult() {
  return {
    price: { regularMarketPrice: 840.1, currency: 'EUR' },
    summaryDetail: { marketCap: 26493974528 },
    financialData: { totalRevenue: 2376361984 },
    earningsHistory: { history: [{ maxAge: 1, epsEstimate: 16.04, period: '-3q' }] }
  };
}

// (a) Adyen-Fall: Fehler nur in earningsHistory, Pflichtfelder da → gerettet.
check('adyen-shape wird gerettet', () => {
  const s = salvageValidationReject(mkErr([EH_MISSING], goodResult()));
  assert.ok(s, 'erwartet Salvage, bekam null');
  assert.strictEqual(s.result.price.regularMarketPrice, 840.1);
  assert.strictEqual(s.result.summaryDetail.marketCap, 26493974528);
  // Missing-props-only → Modul bleibt (Löcher bleiben Löcher):
  assert.ok(s.result.earningsHistory, 'earningsHistory darf bei reinen Missing-Props NICHT entfernt werden');
  assert.deepStrictEqual(s.salvagedModules, ['earningsHistory']);
});

// (a2) mehrere Fehler, alle in Enrichment-Modulen → gerettet.
check('mehrere whitelisted Module gerettet', () => {
  const e2 = { ...EH_MISSING, instancePath: '/earningsTrend/trend/2' };
  const s = salvageValidationReject(mkErr([EH_MISSING, e2], goodResult()));
  assert.ok(s);
  assert.deepStrictEqual(s.salvagedModules, ['earningsHistory', 'earningsTrend']);
});

// (b) verstümmelt: Fehler außerhalb der Enrichment-Module → bleibt Fail.
check('fehler in price → kein Salvage', () => {
  const bad = { ...EH_MISSING, instancePath: '/price/regularMarketPrice', message: 'should be number' };
  assert.strictEqual(salvageValidationReject(mkErr([bad], goodResult())), null);
});
check('fehler in summaryDetail → kein Salvage', () => {
  const bad = { ...EH_MISSING, instancePath: '/summaryDetail/marketCap' };
  assert.strictEqual(salvageValidationReject(mkErr([bad], goodResult())), null);
});
check('gemischt whitelist+price → kein Salvage', () => {
  const bad = { ...EH_MISSING, instancePath: '/price/currency' };
  assert.strictEqual(salvageValidationReject(mkErr([EH_MISSING, bad], goodResult())), null);
});
check('top-level-fehler (leerer instancePath) → kein Salvage', () => {
  const bad = { ...EH_MISSING, instancePath: '' };
  assert.strictEqual(salvageValidationReject(mkErr([bad], goodResult())), null);
});

// (b2) verstümmelt: Pflichtfelder fehlen → bleibt Fail, auch wenn Fehler whitelisted.
check('payload ohne price-Modul → kein Salvage', () => {
  const r = goodResult(); delete r.price;
  assert.strictEqual(salvageValidationReject(mkErr([EH_MISSING], r)), null);
});
check('nicht-finiter Kurs → kein Salvage', () => {
  const r = goodResult(); r.price.regularMarketPrice = NaN;
  assert.strictEqual(salvageValidationReject(mkErr([EH_MISSING], r)), null);
});
check('kurs 0 → kein Salvage', () => {
  const r = goodResult(); r.price.regularMarketPrice = 0;
  assert.strictEqual(salvageValidationReject(mkErr([EH_MISSING], r)), null);
});
check('fehlende currency → kein Salvage', () => {
  const r = goodResult(); delete r.price.currency;
  assert.strictEqual(salvageValidationReject(mkErr([EH_MISSING], r)), null);
});

// Typ-Mismatch (≠ Missing-Props) in whitelisted Modul → Modul fliegt raus,
// Rest wird gerettet (nie schema-invalides Material im Payload).
check('typ-fehler in earningsHistory → Modul entfernt, Rest gerettet', () => {
  const bad = { schemaPath: '#/x', instancePath: '/earningsHistory/history/0/epsActual', message: 'should be number' };
  const s = salvageValidationReject(mkErr([bad], goodResult()));
  assert.ok(s);
  assert.strictEqual(s.result.earningsHistory, undefined, 'Modul mit Typ-Fehler muss entfernt sein');
  assert.strictEqual(s.result.price.regularMarketPrice, 840.1);
});

// Fremde Fehlertypen / degenerierte Inputs → nie retten, nie werfen.
check('fremder error-typ → kein Salvage', () => {
  const e = new Error('boom'); e.name = 'TypeError';
  assert.strictEqual(salvageValidationReject(e), null);
});
check('kein e.result → kein Salvage', () => {
  const e = mkErr([EH_MISSING], undefined);
  assert.strictEqual(salvageValidationReject(e), null);
});
check('leere errors → kein Salvage', () => {
  assert.strictEqual(salvageValidationReject(mkErr([], goodResult())), null);
});
check('null/undefined input → kein Salvage', () => {
  assert.strictEqual(salvageValidationReject(null), null);
  assert.strictEqual(salvageValidationReject(undefined), null);
});

console.log(fail === 0 ? '\nPASS (all assertions ok)' : `\nFAIL (${fail} assertion(s) failed)`);
process.exit(fail ? 1 : 0);
