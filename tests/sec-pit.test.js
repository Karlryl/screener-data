'use strict';
// tests/sec-pit.test.js — PIT-Semantik der lib/sec-pit.js an synthetischen
// Fixtures (kein Zip, kein Netz): (1) „bekannt am Stichtag" filtert auf
// filed <= asOf; (2) „Korrektur gewinnt" = jüngstes filed je Periode;
// (3) YTD-Fakten (BH-017-Falle) fallen aus der Quartals-Serie; (4) Shares-
// Historie (instant) mit denselben Regeln; (5) freshness-first Konzeptwahl.
const assert = require('assert');
const { pitSeries, pitSeriesFromFacts, sharesHistory } = require('../lib/sec-pit.js');

function fixtureCompany() {
  return {
    cik: 1234567,
    entityName: 'Testcorp',
    facts: {
      'us-gaap': {
        Revenues: {
          units: {
            USD: [
              // Q1 2025, original 10-Q, später per 10-Q/A korrigiert:
              { start: '2025-01-01', end: '2025-03-31', val: 100, filed: '2025-05-01', form: '10-Q', fy: 2025, fp: 'Q1' },
              { start: '2025-01-01', end: '2025-03-31', val: 110, filed: '2025-08-15', form: '10-Q/A', fy: 2025, fp: 'Q1' },
              // Q2 2025, sauber:
              { start: '2025-04-01', end: '2025-06-30', val: 130, filed: '2025-08-01', form: '10-Q', fy: 2025, fp: 'Q2' },
              // YTD-6M-Fakt mit fp=Q2 (BH-017-Falle) — darf NIE als Quartal zählen:
              { start: '2025-01-01', end: '2025-06-30', val: 230, filed: '2025-08-01', form: '10-Q', fy: 2025, fp: 'Q2' },
              // Jahresperiode FY2024:
              { start: '2024-01-01', end: '2024-12-31', val: 400, filed: '2025-02-20', form: '10-K', fy: 2024, fp: 'FY' },
            ],
          },
        },
        // Stale-Konzept (MXL-Falle): längere Serie, aber altes jüngstes Ende —
        // freshness-first muss Revenues (jüngeres Ende) wählen.
        SalesRevenueNet: {
          units: {
            USD: [
              { start: '2017-01-01', end: '2017-03-31', val: 50, filed: '2017-05-01', form: '10-Q', fy: 2017, fp: 'Q1' },
              { start: '2017-04-01', end: '2017-06-30', val: 52, filed: '2017-08-01', form: '10-Q', fy: 2017, fp: 'Q2' },
              { start: '2017-07-01', end: '2017-09-30', val: 54, filed: '2017-11-01', form: '10-Q', fy: 2017, fp: 'Q3' },
            ],
          },
        },
      },
      dei: {
        EntityCommonStockSharesOutstanding: {
          units: {
            shares: [
              { end: '2025-04-25', val: 1000, filed: '2025-05-01', form: '10-Q' },
              { end: '2025-07-25', val: 1050, filed: '2025-08-01', form: '10-Q' },
            ],
          },
        },
      },
    },
  };
}

const company = fixtureCompany();
const REVS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'];

// (1) asOf VOR der Korrektur: Original-Wert 100 gewinnt, Q2 noch unbekannt.
{
  const { concept, series } = pitSeries(company, REVS, { asOf: '2025-06-01', period: 'quarterly' });
  assert.strictEqual(concept, 'Revenues', 'freshness-first wählt Revenues');
  assert.strictEqual(series.length, 1, 'am 01.06. ist nur Q1 bekannt');
  assert.strictEqual(series[0].val, 100, 'vor der 10-Q/A gilt der Originalwert');
  assert.strictEqual(series[0].form, '10-Q');
}

// (2) asOf NACH der Korrektur: 110 gewinnt (Korrektur gewinnt), Q2 sichtbar,
//     der YTD-6M-Fakt (230) taucht NIE als Quartal auf.
{
  const { series } = pitSeries(company, REVS, { asOf: '2025-09-01', period: 'quarterly' });
  assert.strictEqual(series.length, 2, 'Q1+Q2 bekannt, YTD gefiltert');
  assert.strictEqual(series[0].end, '2025-06-30');
  assert.strictEqual(series[0].val, 130, 'Q2 diskret, nicht der 230-YTD-Fakt');
  assert.strictEqual(series[1].val, 110, '10-Q/A ersetzt den Originalwert');
  assert.strictEqual(series[1].form, '10-Q/A');
}

// (3) Look-ahead-Beweis: ohne asOf (= alles) identisch zu spätem asOf. Am
//     30.04.2025 (vor dem ersten Revenues-Filing) ist die EHRLICHE Antwort die
//     alte SalesRevenueNet-Serie von 2017 — freshness-first darf dann nur unter
//     dem wählen, was bekannt war. Vor dem allerersten Filing überhaupt: leer.
{
  const all = pitSeries(company, REVS, { period: 'quarterly' });
  assert.strictEqual(all.series.length, 2);
  const stale = pitSeries(company, REVS, { asOf: '2025-04-30', period: 'quarterly' });
  assert.strictEqual(stale.concept, 'SalesRevenueNet', 'damals war nur das Alt-Konzept bekannt');
  assert.strictEqual(stale.series.length, 3);
  const none = pitSeries(company, REVS, { asOf: '2017-04-30', period: 'quarterly' });
  assert.strictEqual(none.series.length, 0, 'vor dem allerersten Filing ist nichts bekannt');
}

// (4) Jahres-Serie: nur die FY-Periode (365d), Quartale/YTD fallen raus.
{
  const { series } = pitSeries(company, REVS, { asOf: '2026-01-01', period: 'annual' });
  assert.strictEqual(series.length, 1);
  assert.strictEqual(series[0].val, 400);
}

// (5) Shares-Historie PIT: am 01.06. nur der erste Stand, später beide.
{
  const early = sharesHistory(company, { asOf: '2025-06-01' });
  assert.strictEqual(early.length, 1);
  assert.strictEqual(early[0].val, 1000);
  const late = sharesHistory(company, { asOf: '2025-12-31' });
  assert.strictEqual(late.length, 2);
  assert.strictEqual(late[0].val, 1050, 'neuester Stand zuerst');
}

// (6) Robustheit: kaputte/fremde Fakten (val fehlt, filed fehlt) fallen still raus.
{
  const s = pitSeriesFromFacts([
    { start: '2025-01-01', end: '2025-03-31', filed: '2025-05-01' },          // ohne val
    { start: '2025-01-01', end: '2025-03-31', val: 7 },                        // ohne filed
    null,
  ], { period: 'quarterly' });
  assert.strictEqual(s.length, 0);
}

// (7) Q4-Ableitung + YoY-Partner (B1-Protokoll §1): FY 400 − (100+130+95) = 75 als
//     derived-Q4 mit filed = max(Bestandteile); yoyPartner findet ~365d-Rückpartner.
{
  const { pitQuarterlyWithDerivedQ4, yoyPartner } = require('../lib/sec-pit.js');
  const c2 = fixtureCompany();
  c2.facts['us-gaap'].Revenues.units.USD.push(
    { start: '2025-07-01', end: '2025-09-30', val: 95, filed: '2025-11-01', form: '10-Q', fy: 2025, fp: 'Q3' },
    { start: '2025-01-01', end: '2025-12-31', val: 400, filed: '2026-02-20', form: '10-K', fy: 2025, fp: 'FY' },
    { start: '2024-01-01', end: '2024-03-31', val: 80, filed: '2024-05-01', form: '10-Q', fy: 2024, fp: 'Q1' },
  );
  const full = pitQuarterlyWithDerivedQ4(c2, ['Revenues'], {});
  const d = full.series.find((p) => p.derived);
  assert.ok(d, 'derived Q4 existiert');
  assert.strictEqual(d.end, '2025-12-31');
  assert.strictEqual(d.val, 400 - (110 + 130 + 95), 'FY minus 3 diskrete (Q1 korrigiert=110)');
  assert.strictEqual(d.filed, '2026-02-20', 'bekannt erst mit dem letzten Bestandteil');
  // Vor dem 10-K (asOf 2026-01-01) darf das derived-Q4 NICHT existieren:
  const early = pitQuarterlyWithDerivedQ4(c2, ['Revenues'], { asOf: '2026-01-01' });
  assert.ok(!early.series.some((p) => p.derived), 'kein derived Q4 vor FY-Filing');
  // yoyPartner: Q1-2025 (end 2025-03-31) -> Q1-2024 (end 2024-03-31), exakt 365d.
  const q1 = full.series.find((p) => p.end === '2025-03-31');
  const partner = yoyPartner(full.series, q1);
  assert.ok(partner && partner.end === '2024-03-31', 'YoY-Partner ~365d zurück');
  // kein Partner ausserhalb ±35d: Q3-2025 hat keinen 2024-Q3-Punkt -> null
  const q3 = full.series.find((p) => p.end === '2025-09-30');
  assert.strictEqual(yoyPartner(full.series, q3), null);
}

console.log('sec-pit.test.js: alle 7 Blöcke grün');
