'use strict';
/**
 * Engine Schicht 1 — Router-Test (Success-Gate (4)).
 * Feste Pruefreihenfolge + GP-Klassifikation gegen echte Anker:
 * SOFI -> Step-2-Exclude (annualGP=0), ICE/CME/NDAQ -> echter GP (r~0.7 trotz
 * gm=100), CRDO -> semiconductors. Plus Pre-Revenue/Struktur/Degen-Edge-Cases.
 *
 * Usage:  node tests/scoring/router.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { route, gpClass } = require('../../src/scoring/router.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'snapshots', t + '.json'), 'utf8'));
}

// --- echte Anker ------------------------------------------------------------
test('CRDO -> route semiconductors', () => {
  const r = route(snap('CRDO'));
  assert.equal(r.action, 'route');
  assert.equal(r.formulaId, 'semiconductors');
});
test('SOFI -> Step-2 Hard-Exclude (lender-gp0), NICHT ueber grossMargin', () => {
  const r = route(snap('SOFI')); // gm=83.5 ABER annualGP=[0,0,0,0]
  assert.equal(r.action, 'exclude');
  assert.equal(r.reason, 'lender-gp0');
});
test('ICE/CME/NDAQ -> financials mit ECHTEM GP (r~0.7 trotz gm=100)', () => {
  for (const t of ['ICE', 'CME', 'NDAQ']) {
    const r = route(snap(t));
    assert.equal(r.action, 'route', t + ' action');
    assert.equal(r.formulaId, 'financials', t + ' formulaId');
    assert.equal(r.gpClass, 'real', t + ' gpClass (Master-Diskriminator, nicht grossMargin)');
  }
});

// --- Universum-Filter: nur US -----------------------------------------------
test('Nicht-US (region != US) -> exclude non-us', () => {
  const s = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'KR' }, annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(s).reason, 'non-us');
});
test('US-Aktie passiert den Filter', () => {
  const s = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US' }, annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(s).action, 'route');
});

test('Auslaendische ADRs (region=Laendercode, US-Boerse) -> exclude non-us', () => {
  const tsm = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'TW', exchangeName: 'NYSE' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(tsm).reason, 'non-us'); // ADR trotz US-Boerse raus
  const adr = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'JP', exchangeName: 'OTC Markets OTCPK' },
    annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(adr).reason, 'non-us');
});
test('US-Name mit Boersennamen in region (SOFI/ICE-Muster) -> bleibt drin', () => {
  const s = { meta: { sector: 'Financial Services', industry: 'Capital Markets', region: 'NasdaqGS' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(s).action, 'route');
});

// --- Schritt 0: Pre-Revenue -------------------------------------------------
test('kein/leerer Umsatz -> survival-track', () => {
  assert.equal(route({ meta: {}, annual: { annualRev: [] } }).action, 'survival');
  assert.equal(route({ meta: {}, annual: { annualRev: [{ value: 0 }, { value: 0 }] } }).track, 'pre-revenue-biotech');
});

// --- Schritt 1: Struktur-Hard-Exclude ---------------------------------------
test('Bilanz-Bank / Versicherer / mREIT -> exclude', () => {
  assert.equal(route({ meta: { sector: 'Financial Services', industry: 'Banks—Regional' }, annual: { annualRev: [{ value: 9 }] } }).reason, 'balance-sheet-bank');
  assert.equal(route({ meta: { sector: 'Financial Services', industry: 'Insurance—Life' }, annual: { annualRev: [{ value: 9 }] } }).reason, 'insurer');
  assert.equal(route({ meta: { sector: 'Real Estate', industry: 'REIT—Mortgage' }, annual: { annualRev: [{ value: 9 }] } }).reason, 'mortgage-reit');
});

// --- Schritt 2 laeuft VOR grossMargin (Reihenfolge-Beweis) ------------------
test('annualGP all-zero -> exclude, auch bei hohem grossMargin', () => {
  const s = { meta: { sector: 'Financial Services', industry: 'Credit Services' },
    metrics: { grossMargin: { value: 95 } },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 0 }, { value: 0 }] } };
  assert.equal(route(s).reason, 'lender-gp0');
});
test('leeres/all-null annualGP -> KEIN Exclude (hasPresent-Schutz)', () => {
  const s = { meta: { sector: 'Technology', industry: 'Software' },
    annual: { annualRev: [{ value: 100 }], annualGP: [] } };
  assert.equal(route(s).action, 'route'); // greift NICHT faelschlich (Gate 2e-Analog)
});

// --- gpClass Master-Diskriminator + Tie-Break -------------------------------
test('gpClass: degenerierter GP (r>=0.99) -> degenerate', () => {
  const s = { annual: { annualGP: [{ value: 100 }], annualRev: [{ value: 100 }] } };
  assert.equal(gpClass(s), 'degenerate');
});
test('gpClass: echter GP (r~0.6) -> real', () => {
  const s = { annual: { annualGP: [{ value: 60 }], annualRev: [{ value: 100 }] } };
  assert.equal(gpClass(s), 'real');
});
test('gpClass Tie-Break: kein GP -> grossMargin entscheidet', () => {
  assert.equal(gpClass({ metrics: { grossMargin: { value: 100 } }, annual: {} }), 'degenerate');
  assert.equal(gpClass({ metrics: { grossMargin: { value: 60 } }, annual: {} }), 'real');
  assert.equal(gpClass({ metrics: {}, annual: {} }), 'none');
});

// --- Regression: Substring-Kollision "credit services".includes("it services") -
test('Credit Services mit echtem GP -> financials (NICHT it-services)', () => {
  const s = { meta: { sector: 'Financial Services', industry: 'Credit Services' },
    annual: { annualRev: [{ value: 1000 }, { value: 800 }], annualGP: [{ value: 600 }, { value: 480 }] } };
  const r = route(s);
  assert.equal(r.formulaId, 'financials');
  assert.equal(r.gpClass, 'real');
});
test('echte IT-Services -> it-services', () => {
  const s = { meta: { sector: 'Technology', industry: 'Information Technology Services' }, annual: { annualRev: [{ value: 100 }] } };
  assert.equal(route(s).formulaId, 'it-services');
});

// --- Regression: Broker/Brokerage NICHT als Bank/Versicherer excludiert -----
test('Versicherungs-Makler & Investment-Brokerage bleiben drin (kein Fehl-Exclude)', () => {
  const broker = { meta: { sector: 'Financial Services', industry: 'Insurance Brokers' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(broker).action, 'route');
  const ib = { meta: { sector: 'Financial Services', industry: 'Investment Banking & Brokerage' },
    annual: { annualRev: [{ value: 100 }], annualGP: [{ value: 60 }] } };
  assert.equal(route(ib).action, 'route');
});

console.log(`\nrouter.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
