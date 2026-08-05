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
const { _convertSnapshotToUSD, _ftsExtractByYear } = require('../../pull-yahoo.js');

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

// --- 4a. Extraktion: AUSGEFUEHRT auf einer gemockten FTS-Antwort ------------
// Bis 03.08.2026 stand hier ein Quelltext-Grep ("kommt dieser String in pull-yahoo.js vor?").
// Der prueft ein Schreibmuster, nicht die Sache: eine gleichwertige Umformulierung der Zeile
// haette ihn rot gemacht, und ein Vorkommen an einer beliebigen anderen Stelle haette ihn
// gruen gehalten, ohne dass je eine Zahl extrahiert wurde. Jetzt laeuft die echte Extraktion
// ueber gemockte Cash-Flow-Zeilen und das ERGEBNIS wird geprueft.
test('Extraktion (ausgefuehrt): die drei Cashflow-Schluessel kommen latest-first und positionsgetreu an', () => {
  // FTS liefert oldest-first; _ftsExtractByYear dreht auf latest-first. Die Luecke in der
  // Mitte muss als null an ihrer Position bleiben (sonst verrutschen die Geschaeftsjahre).
  const annualCash = [
    { repurchaseOfCapitalStock: -100, cashDividendsPaid: -10, netCommonStockIssuance: 25 }, // aeltestes GJ
    null,                                                                                   // GJ ohne Zeile
    { repurchaseOfCapitalStock: -300, cashDividendsPaid: -30, netCommonStockIssuance: -7 }, // juengstes GJ
  ];
  assert.deepEqual(_ftsExtractByYear(annualCash, ['repurchaseOfCapitalStock']), [-300, null, -100],
    'annualRepurchase: falscher Schluessel, falsche Reihenfolge oder verschluckte Luecke');
  assert.deepEqual(_ftsExtractByYear(annualCash, ['cashDividendsPaid']), [-30, null, -10],
    'annualDividendsPaid: falscher Schluessel, falsche Reihenfolge oder verschluckte Luecke');
  assert.deepEqual(_ftsExtractByYear(annualCash, ['netCommonStockIssuance']), [-7, null, 25],
    'annualNetCommonStockIssuance: falscher Schluessel, falsche Reihenfolge oder verschluckte Luecke');
  // Gegenprobe: ein FREMDER Schluessel darf NICHTS liefern — sonst wuerde der Test auch dann
  // gruen bleiben, wenn die Extraktion die Namen gar nicht mehr beachtet.
  assert.deepEqual(_ftsExtractByYear(annualCash, ['gibtEsNicht']), [null, null, null]);
  // DER PRAXIS-NORMALFALL (Luecke 03.08.2026): bis zum FTS-Cache-Ablauf (28 Tage) liefert
  // Yahoo fuer die meisten Namen ueberhaupt keine Cash-Flow-Zeilen, und _ftsExtractByYear
  // bekommt undefined statt eines Arrays. Das MUSS eine leere Reihe geben — nicht werfen und
  // nicht [null] — sonst faellt der Pull genau bei der Mehrheit der Namen um. Der haeufigste
  // Fall war bis hierher der einzige ungetestete.
  assert.deepEqual(_ftsExtractByYear(undefined, ['repurchaseOfCapitalStock']), []);
  assert.deepEqual(_ftsExtractByYear(null, ['repurchaseOfCapitalStock']), []);
  assert.deepEqual(_ftsExtractByYear([], ['repurchaseOfCapitalStock']), []);
});

// --- 4b. Verdrahtung: Cache-Payload und canonical.annual --------------------
// canonical.annual liegt mitten in pullAll() (Netzwerk-Pfad, kein aufrufbarer Einstieg)
// und bleibt deshalb bewusst eine Quelltext-Pruefung. Die Cache-Payload-Haelfte ging bis
// Tag 591 direkt auf das Inline-Objektliteral `payload: {...}`; Tag 591 verschob den Write
// in die Seam-Funktion _writeFTSCache(cachePath, version, partial, payload) — der Callsite
// in pullAll() uebergibt das Payload-Objekt jetzt als viertes Argument. Verankert wird daher
// nicht mehr auf das alte `payload:`-Schreibmuster, sondern auf das Objekt-Argument des
// _writeFTSCache(...)-Aufrufs selbst — die SACHE (landet die Reihe im geschriebenen Cache?)
// bleibt je Feld einzeln pruefbar.
test('pull-yahoo fuehrt jede Reihe in den _writeFTSCache-Aufruf und in canonical.annual', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', '..', 'pull-yahoo.js'), 'utf8');
  // [^)]* vor der `{` schliesst die Funktionsdefinition `_writeFTSCache(a, b, c, payload) {`
  // aus: deren Parameterliste enthaelt kein `{` vor dem schliessenden `)`, also matcht der
  // Regex erst am tatsaechlichen Aufruf mit dem inline Objektliteral als viertem Argument.
  const aufrufMatch = /_writeFTSCache\([^)]*\{([^}]*)\}[^)]*\)/s.exec(quelle);
  assert.ok(aufrufMatch, 'kein _writeFTSCache(...)-Aufruf mit Objekt-Argument in pull-yahoo.js gefunden');
  const payloadArgument = aufrufMatch[1];
  for (const feld of FELDER) {
    const variable = 'ftsAnnual' + feld.slice('annual'.length);
    assert.ok(new RegExp(`\\b${variable}\\b`).test(payloadArgument),
      `${feld}: ${variable} fehlt im Objekt-Argument von _writeFTSCache — der naechste Lauf zieht es aus dem Cache als undefined`);
    assert.ok(quelle.includes(`canonical.annual.${feld} = ${variable}`),
      `${feld}: landet nicht in canonical.annual — der Snapshot bekommt die Reihe nie`);
    assert.ok(new RegExp(`${variable}\\s*=\\s*_realignFtsAnchoredSeries\\(`).test(quelle),
      `${feld}: fehlt im Anker-Versatz-Block — koennte gegen ein fremdes Geschaeftsjahr stehen`);
  }
});

console.log(`\nf1-ausschuettungsfelder.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
