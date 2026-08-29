// Tag 642 — ERSTE Testdatei fuer discovery/mcap-prefilter.js (Tor 2 der Entdeckung).
//
// WARUM ES SIE BISHER NICHT GAB UND WARUM DAS TEUER WAR: dieses Tor entscheidet, welche
// AUSLANDS-Zeile ueberhaupt ins Universum kommt (refresh-universe.js Z.~1630: nur Quellen
// aus FOREIGN_CANON_SET mit marketCap:null laufen hier durch). Es hatte weder einen Test
// noch ein Protokoll: `applyForeignPrefilterOutcome` loeschte die Durchgefallenen per
// `allTickers.delete(eff)` ohne Grund je Ticker, und die einzige Spur war eine
// Aggregat-Logzeile. Eine falsch gesetzte Schwelle haette monatelang unbemerkt Firmen
// gefressen — genau die stille Fehlerklasse, die dieses Repo sonst ueberall jagt.
//
// GEPRUEFT WIRD DIE SACHE, NICHT DIE SCHREIBWEISE:
//   * ein Titel mit 1,2 Mrd. USD faellt bei der HEUTIGEN Schwelle ($2 Mrd) durch und
//     kommt bei $800 Mio. durch — die beiden Erwartungen sind nachweislich VERSCHIEDEN,
//     ein Test, der bei beiden Schwellen dasselbe sagt, wuerde nichts beweisen;
//   * ein Titel mit 600 Mio. USD bleibt AUCH bei $800 Mio. draussen (Karls Boden);
//   * die Begruendung des Ausschlusses (belowUsd) traegt den gemessenen Marktwert —
//     ohne sie ist das Ausschluss-Protokoll leer und der Drop wieder still.
//
// Hermetisch: kein Netz. prefilterByMcap nimmt opts.quote (Ersatz fuer yf.quote) und
// opts.rates (Ersatz fuer fx-rates.json).
//
// Run: node tests/mcap-prefilter.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const { prefilterByMcap, toUsd, isUnpriceable, kosdaqTarget } = require('../discovery/mcap-prefilter.js');

let fail = 0;
const pending = [];
function check(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { console.log('  ok   ' + name); },
    (e) => { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }));
}

// Ein fester Kurszettel. EUR-Kurs 1.0 gewaehlt, damit die Bandgrenzen 1:1 in USD lesbar
// bleiben — der Test misst die SCHWELLE, nicht die Waehrungsrechnung (die haengt an toUsd
// und wird unten separat geprueft).
const RATES = { USD: 1, EUR: 1, GBP: 1, KRW: 1 };
const KURSZETTEL = {
  'GROSS.PA': { marketCap: 3.0e9, currency: 'EUR', quoteType: 'EQUITY' },   // klar drueber
  'BAND.PA':  { marketCap: 1.2e9, currency: 'EUR', quoteType: 'EQUITY' },   // 1,2 Mrd — der Streitfall
  'KLEIN.PA': { marketCap: 0.6e9, currency: 'EUR', quoteType: 'EQUITY' },   // 600 Mio — Karls Boden
  'GRENZE.PA':{ marketCap: 0.8e9, currency: 'EUR', quoteType: 'EQUITY' },   // exakt 800 Mio
};
const ALLE = Object.keys(KURSZETTEL);
const quote = async (batch) => batch.map((s) => Object.assign({ symbol: s }, KURSZETTEL[s]));

// ── Der Kern: dieselben Ticker, zwei Schwellen, VERSCHIEDENE Ergebnisse ──────────
check('heutige Schwelle $2 Mrd: 1,2-Mrd-Titel faellt durch, 3-Mrd-Titel bleibt', async () => {
  const r = await prefilterByMcap(ALLE, { minUsd: 2e9, quote, rates: RATES });
  assert.deepEqual([...r.kept.keys()].sort(), ['GROSS.PA']);
  assert.ok(!r.kept.has('BAND.PA'), 'BAND.PA (1,2 Mrd) darf bei $2 Mrd NICHT durchkommen');
});

check('Schwelle $800 Mio: derselbe 1,2-Mrd-Titel kommt jetzt durch', async () => {
  const r = await prefilterByMcap(ALLE, { minUsd: 800e6, quote, rates: RATES });
  assert.ok(r.kept.has('BAND.PA'), 'BAND.PA (1,2 Mrd) muss bei $800 Mio durchkommen');
  assert.equal(r.kept.get('BAND.PA'), 1.2e9);
});

check('Karls Boden haelt: 600-Mio-Titel bleibt auch bei $800 Mio draussen', async () => {
  const r = await prefilterByMcap(ALLE, { minUsd: 800e6, quote, rates: RATES });
  assert.ok(!r.kept.has('KLEIN.PA'), 'KLEIN.PA (600 Mio) darf bei $800 Mio NICHT durchkommen');
  assert.equal(r.belowUsd.get('KLEIN.PA'), 0.6e9);
});

check('die Grenze selbst ist eingeschlossen (>=, nicht >)', async () => {
  const r = await prefilterByMcap(ALLE, { minUsd: 800e6, quote, rates: RATES });
  assert.ok(r.kept.has('GRENZE.PA'), 'exakt 800 Mio muss drin sein (>=)');
});

// ── Das Protokoll: ohne belowUsd ist der Ausschluss wieder still ─────────────────
check('belowUsd begruendet JEDEN Ausschluss mit dem gemessenen Marktwert', async () => {
  const r = await prefilterByMcap(ALLE, { minUsd: 2e9, quote, rates: RATES });
  assert.deepEqual([...r.belowUsd.keys()].sort(), ['BAND.PA', 'GRENZE.PA', 'KLEIN.PA']);
  assert.equal(r.belowUsd.get('BAND.PA'), 1.2e9);
  // Gegenprobe: was durchkam, darf NICHT im Ausschluss-Register stehen.
  assert.ok(!r.belowUsd.has('GROSS.PA'), 'ein aufgenommener Titel gehoert nicht ins Ausschluss-Register');
});

check('kept und belowUsd sind zusammen vollstaendig (kein Ticker verschwindet lautlos)', async () => {
  const r = await prefilterByMcap(ALLE, { minUsd: 2e9, quote, rates: RATES });
  assert.equal(r.kept.size + r.belowUsd.size, ALLE.length,
    'jede beantwortete, bepreisbare Zeile muss in genau einem der beiden Register stehen');
});

// ── Die bestehenden Sonderfaelle duerfen die neue Buchfuehrung nicht verwaessern ──
check('unbekannte Waehrung -> unpriceable, NICHT als "unter Schwelle" verbucht', async () => {
  const q = async (b) => b.map((s) => ({ symbol: s, marketCap: 5e9, currency: 'XXX', quoteType: 'EQUITY' }));
  const r = await prefilterByMcap(['MYSTERY.XX'], { minUsd: 2e9, quote: q, rates: RATES });
  assert.ok(r.unpriceable.has('MYSTERY.XX'));
  assert.ok(!r.belowUsd.has('MYSTERY.XX'), 'eine FX-Luecke ist kein Groessen-Befund');
  assert.ok(!r.kept.has('MYSTERY.XX'));
});

check('Nicht-Equity (ETF) wird gar nicht bewertet — weder kept noch belowUsd', async () => {
  const q = async (b) => b.map((s) => ({ symbol: s, marketCap: 1e8, currency: 'EUR', quoteType: 'ETF' }));
  const r = await prefilterByMcap(['FONDS.PA'], { minUsd: 2e9, quote: q, rates: RATES });
  assert.ok(!r.kept.has('FONDS.PA'));
  assert.ok(!r.belowUsd.has('FONDS.PA'), 'ein ETF ist kein zu klein befundenes Unternehmen');
});

// Review-Befund zum Erstwurf: der Nicht-Aktie-Pfad war der DRITTE stille Weg. Die Zeile
// verschwand aus dem Universum und stand im Protokoll unter "Marktwert unbekannt" — falsche
// Begruendung, und genau die Sorte Halbwahrheit, gegen die Tag 642 gebaut wurde.
check('Nicht-Equity landet im eigenen Register nichtAktie (nicht unter "unbekannt")', async () => {
  const q = async (b) => b.map((s) => ({ symbol: s, marketCap: 1e8, currency: 'EUR',
    quoteType: s === 'FONDS.PA' ? 'ETF' : 'EQUITY' }));
  const r = await prefilterByMcap(['FONDS.PA', 'ECHT.PA'], { minUsd: 2e9, quote: q, rates: RATES });
  assert.ok(r.nichtAktie.has('FONDS.PA'), 'der ETF muss als "keine Aktie" gefuehrt sein');
  assert.ok(!r.nichtAktie.has('ECHT.PA'), 'eine echte Aktie gehoert NICHT in dieses Register');
  assert.ok(r.belowUsd.has('ECHT.PA'), 'die echte Aktie ist ein Groessen-Befund');
  assert.ok(!r.unpriceable.has('FONDS.PA'));
});

check('fehlender quoteType bleibt fail-open (wird bewertet, nicht als Nicht-Aktie verbucht)', async () => {
  const q = async (b) => b.map((s) => ({ symbol: s, marketCap: 3e9, currency: 'EUR' }));
  const r = await prefilterByMcap(['OHNETYP.PA'], { minUsd: 2e9, quote: q, rates: RATES });
  assert.ok(r.kept.has('OHNETYP.PA'));
  assert.equal(r.nichtAktie.size, 0);
});

check('Batch-Fehler bleibt unbeantwortet (kein stiller Ausschluss)', async () => {
  const q = async () => { throw new Error('429'); };
  const r = await prefilterByMcap(ALLE, { minUsd: 2e9, quote: q, rates: RATES });
  assert.equal(r.answered.size, 0);
  assert.equal(r.belowUsd.size, 0, 'ein Netzfehler darf niemanden als "zu klein" verbuchen');
  assert.equal(r.kept.size, 0);
});

// ── Reine Helfer (waren bisher ebenfalls ungetestet) ─────────────────────────────
check('toUsd rechnet Pence korrekt (GBp -> GBP/100)', () => {
  assert.equal(toUsd(200e9, 'GBp', { GBP: 1.3 }), 200e9 / 100 * 1.3);
});
check('toUsd: fehlende Waehrung -> null (fail-closed)', () => {
  assert.equal(toUsd(2e9, 'XXX', { USD: 1 }), null);
});
check('isUnpriceable trennt FX-Luecke von "kein Marktwert"', () => {
  assert.equal(isUnpriceable(2e9, 'XXX', { USD: 1 }), true);
  assert.equal(isUnpriceable(0, 'EUR', { EUR: 1 }), false);
});
check('kosdaqTarget schreibt nur .KS-Symbole mit KOSDAQ-Beleg um', () => {
  assert.equal(kosdaqTarget('005930.KS', { fullExchangeName: 'KOSDAQ' }), '005930.KQ');
  assert.equal(kosdaqTarget('005930.KS', { fullExchangeName: 'KSE' }), null);
  assert.equal(kosdaqTarget('BAND.PA', { fullExchangeName: 'KOSDAQ' }), null);
});

Promise.all(pending).then(() => {
  console.log(fail ? `\nmcap-prefilter: ${fail} FAILED` : '\nmcap-prefilter: all passed');
  process.exit(fail ? 1 : 0);
});
