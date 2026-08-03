'use strict';
/**
 * F-1 (Karl-Mandat 03.08.2026), Chunk A3.1 — Ausschuettungs-Reihen erfassen.
 * =========================================================================
 * Karls Trennung: "Investitionen, die dem Unternehmen zugutekommen, sind nichts Schlechtes;
 * Auszahlungen an Aktionaere schon." Bevor eine solche Unterscheidung ueberhaupt gebaut werden
 * kann, muessen die Zahlen im Snapshot stehen. Dieser Chunk erfasst sie — und NUR das:
 * kein Scoring-Konsument, keine Strafe (Beleg: scripts/score-digest.js, Digest unveraendert).
 *
 * Was hier festgenagelt wird — die SACHE, nicht ein Schreibmuster:
 *   1. Die drei Reihen sind ueber norm() lesbar (FIELD_REGISTRY, Skalar-Form).
 *   2. Der externe Schluessel-Vertrag: yahoo-finance2 fuehrt genau diese drei camelCase-Keys
 *      im cash-flow-Modul. Benennt ein Bibliotheks-Upgrade sie um, liefert _ftsExtractByYear
 *      still fuer immer null — dieser Test wird stattdessen rot.
 *   3. Sie sind Waehrungs-Betraege und laufen durch die FX-Umrechnung (annualShares als
 *      Kontrolle: Stueckzahl, darf NICHT skaliert werden).
 *   4. pull-yahoo verdrahtet jede der drei Reihen an allen DREI noetigen Stellen
 *      (FTS-Extraktion, Cache-Payload, canonical.annual) — je Feld einzeln geprueft, damit
 *      ein Vorkommen an einer anderen Stelle den Test nicht gruen haelt.
 *
 * Standalone: node tests/scoring/f1-ausschuettungsfelder.test.js   (Exit 0/1), netzwerkfrei.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { norm, presentValues, FIELD_REGISTRY } = require('../../src/scoring/snapshot.js');
const { _convertSnapshotToUSD } = require('../../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const FELDER = ['annualRepurchase', 'annualDividendsPaid', 'annualNetCommonStockIssuance'];
// Bibliotheks-Schluessel -> Snapshot-Feld. Die linke Seite MUSS mit pull-yahoo.js uebereinstimmen.
const YF_KEYS = {
  repurchaseOfCapitalStock: 'annualRepurchase',
  cashDividendsPaid: 'annualDividendsPaid',
  netCommonStockIssuance: 'annualNetCommonStockIssuance',
};

// --- 1. FIELD_REGISTRY: ueber norm() lesbar, Skalar-Form ---------------------
test('FIELD_REGISTRY kennt die drei Ausschuettungs-Reihen als annual/scalar', () => {
  for (const f of FELDER) {
    assert.deepEqual(FIELD_REGISTRY[f], ['annual', 'scalar'], f + ' fehlt oder hat die falsche Form');
  }
});
test('norm() liefert die Reihen positionsgetreu (null-Platzhalter bleiben)', () => {
  const s = { annual: { annualRepurchase: [-500, null, -300], annualDividendsPaid: [-120, -110],
    annualNetCommonStockIssuance: [-480, 25] } };
  assert.deepEqual(norm(s, 'annualRepurchase'), [-500, null, -300]);
  assert.deepEqual(presentValues(norm(s, 'annualRepurchase')), [-500, -300]);
  assert.deepEqual(presentValues(norm(s, 'annualDividendsPaid')), [-120, -110]);
  assert.deepEqual(presentValues(norm(s, 'annualNetCommonStockIssuance')), [-480, 25]);
});
test('norm() auf einem Snapshot OHNE die Reihen -> leer, kein Wurf (Rotations-Luecke ist normal)', () => {
  // Die Felder fuellen sich erst mit dem FTS-Cache-Ablauf (28 Tage). Bis dahin fehlen sie
  // bei den meisten Namen — das darf keinen Konsumenten werfen lassen.
  for (const f of FELDER) assert.deepEqual(norm({ annual: {} }, f), []);
});

// --- 2. Externer Schluessel-Vertrag gegen yahoo-finance2 ---------------------
test('yahoo-finance2 fuehrt alle drei Keys im cash-flow-Modul (Umbenennung wird rot)', () => {
  const schemaDatei = path.join(__dirname, '..', '..', 'node_modules', 'yahoo-finance2',
    'script', 'src', 'modules', 'fundamentalsTimeSeries.schema.js');
  if (!fs.existsSync(schemaDatei)) {
    // node_modules nicht installiert -> der Vertrag ist hier nicht pruefbar. Nicht still
    // durchwinken, sondern sichtbar melden (der CI-Lauf hat node_modules immer).
    throw new Error('Bibliotheks-Schema nicht gefunden: ' + schemaDatei);
  }
  const text = fs.readFileSync(schemaDatei, 'utf8');
  const start = text.indexOf('"FundamentalsTimeSeriesCashFlowResult"');
  assert.ok(start > 0, 'Definition FundamentalsTimeSeriesCashFlowResult nicht gefunden');
  const ende = text.indexOf('"FundamentalsTimeSeriesAllResult"', start);
  const block = text.slice(start, ende > start ? ende : undefined);
  for (const key of Object.keys(YF_KEYS)) {
    assert.ok(block.includes(`"${key}"`), `yahoo-finance2 cash-flow kennt "${key}" nicht mehr — pull-yahoo.js zieht dann still null`);
  }
});

// --- 3. FX: Waehrungs-Betraege werden skaliert, Stueckzahlen nicht ----------
test('FX-Umrechnung skaliert die drei Reihen (annualShares als Kontrolle unveraendert)', () => {
  const s = {
    meta: { ticker: 'F1TEST', reportingCurrency: 'EUR', tradingCurrency: 'EUR' },
    annual: { annualRev: [{ value: 100 }], annualRepurchase: [-50, -40], annualDividendsPaid: [-10],
      annualNetCommonStockIssuance: [7], annualShares: [1000] },
  };
  const o = _convertSnapshotToUSD(s);
  const f = o.meta.fxRateApplied;
  assert.ok(Number.isFinite(f) && f > 0, 'kein FX-Faktor angewandt — Test nicht aussagekraeftig');
  assert.ok(Math.abs(o.annual.annualRepurchase[0] - (-50 * f)) < 1e-9, 'annualRepurchase nicht skaliert');
  assert.ok(Math.abs(o.annual.annualRepurchase[1] - (-40 * f)) < 1e-9, 'annualRepurchase[1] nicht skaliert');
  assert.ok(Math.abs(o.annual.annualDividendsPaid[0] - (-10 * f)) < 1e-9, 'annualDividendsPaid nicht skaliert');
  assert.ok(Math.abs(o.annual.annualNetCommonStockIssuance[0] - (7 * f)) < 1e-9, 'annualNetCommonStockIssuance nicht skaliert');
  assert.equal(o.annual.annualShares[0], 1000, 'annualShares ist eine Stueckzahl und darf NICHT skaliert werden');
});

// --- 4. Verdrahtung in pull-yahoo.js: alle drei Stellen, je Feld einzeln ----
test('pull-yahoo verdrahtet jede Reihe an Extraktion, Cache-Payload und canonical.annual', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', '..', 'pull-yahoo.js'), 'utf8');
  for (const [yfKey, feld] of Object.entries(YF_KEYS)) {
    const variable = 'ftsAnnual' + feld.slice('annual'.length);
    assert.ok(quelle.includes(`${variable} = _ftsExtractByYear(fts.annualCash, ['${yfKey}'])`),
      `${feld}: Extraktion aus fts.annualCash mit Schluessel '${yfKey}' fehlt`);
    assert.ok(new RegExp(`payload:\\s*\\{[^}]*\\b${variable}\\b`, 's').test(quelle),
      `${feld}: ${variable} fehlt im FTS-Cache-Payload — der naechste Lauf zieht es aus dem Cache als undefined`);
    assert.ok(quelle.includes(`canonical.annual.${feld} = ${variable}`),
      `${feld}: landet nicht in canonical.annual — der Snapshot bekommt die Reihe nie`);
    assert.ok(new RegExp(`${variable}\\s*=\\s*_realignFtsAnchoredSeries\\(`).test(quelle),
      `${feld}: fehlt im Anker-Versatz-Block — koennte gegen ein fremdes Geschaeftsjahr stehen`);
  }
});

console.log(`\nf1-ausschuettungsfelder.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
