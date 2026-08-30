'use strict';
// tests/sec-pit.test.js — PIT-Semantik der lib/sec-pit.js an synthetischen
// Fixtures (kein Netz): (1) „bekannt am Stichtag" filtert auf
// filed <= asOf; (2) „Korrektur gewinnt" = jüngstes filed je Periode;
// (3) YTD-Fakten (BH-017-Falle) fallen aus der Quartals-Serie; (4) Shares-
// Historie (instant) mit denselben Regeln; (5) freshness-first Konzeptwahl.
//
// Blöcke 9-15 (ENTSCHIED 95, Auflagen 2-4) prüfen die ZIP-Schicht — openStore,
// entryFilter, entryNames, readEntryByName — gegen ein ECHTES, im Test gebautes
// Archiv (tests/helpers/zip-fixture.js). Vorher hatte diese Schicht null
// Abdeckung: die Blöcke 1-8 fassen kein ZIP an.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const secPit = require('../lib/sec-pit.js');
const { pitSeries, pitSeriesFromFacts, sharesHistory, pitQuarterlyWithDerivedQ4 } = secPit;
const { openStore, cikEntryName } = secPit;
const { baueZip } = require('./helpers/zip-fixture.js');

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

// (8 / F4) FY und diskrete Quartale aus verschiedenen Konzepten duerfen nie zu
//     einem synthetischen Q4 vermischt werden.
{
  const mixed = {
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: [
          { start: '2025-01-01', end: '2025-12-31', val: 400, filed: '2026-02-20', form: '10-K', fy: 2025, fp: 'FY' },
        ] } },
        SalesRevenueNet: { units: { USD: [
          { start: '2025-01-01', end: '2025-03-31', val: 100, filed: '2025-05-01', form: '10-Q', fy: 2025, fp: 'Q1' },
          { start: '2025-04-01', end: '2025-06-30', val: 110, filed: '2025-08-01', form: '10-Q', fy: 2025, fp: 'Q2' },
          { start: '2025-07-01', end: '2025-09-30', val: 120, filed: '2025-11-01', form: '10-Q', fy: 2025, fp: 'Q3' },
        ] } },
      },
    },
  };
  const got = pitQuarterlyWithDerivedQ4(mixed, ['Revenues', 'SalesRevenueNet'], {});
  assert.ok(!got.series.some((p) => p.derived), 'F4: kein derived Q4 ueber Konzeptgrenzen');
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP-Schicht (ENTSCHIED 95 / morgen-schritt5-secpit-worktrees-2026-08-30.md).
// Bis hierher hat KEIN Test dieser Datei ein ZIP geöffnet — entryFilter,
// entryNames() und readEntryByName() gingen mit null Abdeckung ins Repo, an eine
// Bibliothek mit drei fremden Konsumenten (b1-validate, b1-instrument,
// sec-pit-check) plus dem Bulk-Pfad von scripts/exit-event-resolver.js.
// Fixture ist ein echtes Archiv, kein Mock: die Fehler, die dieser Code machen
// kann, sind Byte-Versätze — ein Mock, der Offsets zurückgibt statt sie zu
// berechnen, ließe genau diese Klasse durch.
const ZIP_DATEIEN = [
  { name: cikEntryName(1), inhalt: JSON.stringify({ cik: 1, entityName: 'Eins', facts: { 'us-gaap': {} } }) },
  // Der auszufilternde Eintrag steht MITTEN im Verzeichnis und trägt ein
  // Zusatzfeld UND einen Kommentar im Zentralverzeichnis-Kopf. Beides zusammen
  // ist der Prüfstein für die Positionsfortschaltung im übersprungenen Zweig:
  // wer dort `pos += 46 + fnLen` rechnet statt `+ extraLen + commentLen`, landet
  // im nächsten Durchlauf mitten im Namen und verliert CIK 2 stumm. Stünde
  // other.txt am Ende oder wären beide Längen 0, wäre dieser Off-by-one von
  // außen nicht unterscheidbar — dann prüfte Block 10 nichts.
  { name: 'other.txt', inhalt: 'kein CIK-Eintrag', cdZusatzLen: 9, cdKommentar: 'kommentar' },
  // Zusatzfeld NUR im lokalen Kopf: wer die Längen aus dem Zentralverzeichnis
  // nimmt, liest 17 Byte versetzt und bekommt Datenmüll statt Inhalt.
  { name: cikEntryName(2), inhalt: JSON.stringify({ cik: 2, entityName: 'Zwei', facts: { 'us-gaap': {} } }), zusatzLen: 17 },
];
const INHALT = (name) => ZIP_DATEIEN.find((d) => d.name === name).inhalt;
const ZIP_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-pit-zip-'));
const ZIP_PFAD = path.join(ZIP_TMP, 'fixture.zip');
fs.writeFileSync(ZIP_PFAD, baueZip(ZIP_DATEIEN));
const NUR_CIK = (n) => /^CIK\d{10}\.json$/.test(n);
/** Öffnet den Store, führt fn aus und schließt ihn auch im Fehlerfall. */
function mitStore(opt, fn) {
  const store = openStore(ZIP_PFAD, opt);
  try { return fn(store); } finally { store.close(); }
}

try {

// (9 / Auflage 2a) Ohne Filter ist das Verhalten unverändert — das ist die
//     Zusicherung für die drei Bestandsaufrufer, die openStore() ohne Argument rufen.
mitStore(undefined, (s) => {
  assert.strictEqual(s.entryCount, 3, '9: ungefiltert müssen alle drei Einträge im Index liegen');
  assert.deepStrictEqual(s.entryNames().sort(), ZIP_DATEIEN.map((d) => d.name).sort(), '9: entryNames() = alle Namen');
  assert.strictEqual(s.hasCik(1), true, '9: hasCik(1)');
  assert.strictEqual(s.hasCik(999), false, '9: eine wirklich fehlende CIK bleibt false');
  assert.strictEqual(s.factsForCik(2).entityName, 'Zwei', '9: factsForCik parst weiter');
  assert.strictEqual(s.factsForCik(999), null, '9: fehlende CIK ohne Filter -> null, kein Wurf');
});

// (10 / Auflage 2b) Mit Filter landen nur passende Namen im Index, und
//     entryCount und entryNames() sagen dasselbe. Ein Off-by-one in der
//     Positionsfortschaltung des übersprungenen Eintrags fällt hier auf.
mitStore({ entryFilter: NUR_CIK }, (s) => {
  assert.strictEqual(s.entryCount, 2, '10: nur die beiden CIK-Einträge sind indiziert');
  assert.deepStrictEqual(s.entryNames().sort(), [cikEntryName(1), cikEntryName(2)], '10: entryNames() ohne other.txt');
  assert.strictEqual(s.entryNames().length, s.entryCount, '10: entryCount und entryNames() müssen konsistent sein');
  assert.strictEqual(s.hasCik(1), true, '10: der Filter darf die behaltenen Einträge nicht verschieben');
  assert.strictEqual(s.factsForCik(2).entityName, 'Zwei', '10: Eintrag NACH dem übersprungenen liest korrekt');
});

// (11 / Auflage 2c) readEntryByName: byte-korrekter Roh-Buffer; null für
//     ausgefilterte UND für unbekannte Namen — beide sagen dasselbe wie der
//     EDGAR-Rückfallpfad in scripts/exit-event-resolver.js: "existiert nicht".
mitStore({ entryFilter: NUR_CIK }, (s) => {
  const buf = s.readEntryByName(cikEntryName(2));
  assert.ok(Buffer.isBuffer(buf), '11: readEntryByName liefert einen Buffer');
  assert.strictEqual(buf.toString('utf8'), INHALT(cikEntryName(2)), '11: Inhalt byte-korrekt (Zusatzfeld im lokalen Kopf!)');
  assert.strictEqual(s.readEntryByName('other.txt'), null, '11: ausgefilterter Name -> null');
  assert.strictEqual(s.readEntryByName('gibtsnicht.json'), null, '11: unbekannter Name -> null');
});

// (12 / Auflage 2d) Ein alles ablehnender Filter ergibt einen leeren Index —
//     und stürzt nicht ab. Der Grenzfall, an dem eine Schleife über ein leeres
//     Zentralverzeichnis gern hängt.
mitStore({ entryFilter: () => false }, (s) => {
  assert.strictEqual(s.entryCount, 0, '12: leerer Index');
  assert.deepStrictEqual(s.entryNames(), [], '12: keine Namen');
  assert.strictEqual(s.readEntryByName(cikEntryName(1)), null, '12: nichts lesbar');
});

// (13 / Auflage 2e) Ein werfender Filter propagiert laut, statt still einen
//     zu kleinen Index zu liefern. "Zu wenige Treffer" ist genau die Klasse
//     Fehler, die später als "EDGAR ist halt langsam" durchgeht.
assert.throws(
  () => openStore(ZIP_PFAD, { entryFilter: () => { throw new Error('Filter kaputt'); } }),
  /Filter kaputt/,
  '13: der Fehler des Filters darf nicht geschluckt werden',
);

// (14 / Auflage 3) Wächter auf das Introspektions-Token.
//     scripts/exit-event-resolver.js:293 (PR #113) prüft das Feature per
//     Quelltext-Introspektion — /entryFilter/.test(String(secPit.openStore)) —,
//     weil ein Probe-AUFRUF den 988.373-Einträge-Index bauen würde, den der
//     Filter gerade vermeiden soll. Verschwindet das Literal (Umbenennung,
//     Wrapper, anderes Destrukturieren), fällt der Resolver STILL auf den
//     EDGAR-Pfad zurück: gleiche Daten, langsamer, kein Alarm. Diese Wache ist
//     die einzige Stelle, an der diese unsichtbare Kopplung sichtbar wird.
assert.ok(
  /entryFilter/.test(String(secPit.openStore)),
  '14: openStore hat das Literal "entryFilter" verloren — exit-event-resolver.js:293 fällt damit still auf EDGAR zurück',
);
assert.ok(
  /^function openStore\s*\([^)]*\{\s*entryFilter\s*\}/.test(String(secPit.openStore)),
  '14: das Token muss in der SIGNATUR von openStore stehen, nicht bloss irgendwo im Rumpf',
);

// (15 / Auflage 4) Der gefilterte Store darf "nicht indiziert" nicht als
//     "nicht vorhanden" ausgeben. Vor diesem Riegel meldete hasCik(1) false und
//     factsForCik(1) null, obwohl CIK0000000001.json im Archiv liegt — falsche
//     Negative, die aussehen wie Daten. Die Label-Store-Spur (ENTSCHIED 86) ist
//     genau der Konsument, der enge Filter setzen wird.
mitStore({ entryFilter: (n) => n === 'other.txt' }, (s) => {
  assert.throws(() => s.hasCik(1), /nicht indiziert/, '15: hasCik muss werfen statt false zu melden');
  assert.throws(() => s.factsForCik(1), /nicht indiziert/, '15: factsForCik muss werfen statt null zu melden');
});
// Gegenprobe: ohne Filter wirft nichts (Bestandsaufrufer bleiben unberührt) —
// sonst prüfte Block 15 nur, dass irgendetwas wirft.
mitStore(undefined, (s) => {
  assert.strictEqual(s.hasCik(1), true, '15: ohne Filter unverändert');
  assert.strictEqual(s.hasCik(999), false, '15: ohne Filter bleibt "fehlt" ein sauberes false');
});

} finally {
  fs.rmSync(ZIP_TMP, { recursive: true, force: true });
}

console.log('sec-pit.test.js: alle 15 Blöcke grün (8 PIT + 7 ZIP-Schicht)');
