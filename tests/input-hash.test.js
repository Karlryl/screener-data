'use strict';
/**
 * Waechter zum inputHash (Rat 23.08., Weichen B1/B2 - "Drift ueber inputHash trennen").
 *
 * Festgenagelt wird die SACHE, nicht ein Textmuster: der Hash muss auf JEDES Feld reagieren,
 * das die Achsen lesen, und auf KEIN Kursfeld. Die Pruefliste wird zur Laufzeit aus dem
 * FIELD_REGISTRY erzeugt - wer dort ein Feld ergaenzt, bekommt automatisch eine Probe dafuer.
 * Genau deshalb kann dieser Test nicht veralten, ohne rot zu werden.
 *
 * HERMETISCH mit Absicht: der Testsnapshot wird im Test gebaut, nicht aus snapshots/ gelesen.
 * Das blockierende Gate laeuft VOR dem Yahoo-Pull, wo das Snapshot-Verzeichnis leer ist; ein
 * Test, der dort ueberspringt, meldet gruen, ohne etwas geprueft zu haben (siehe
 * anchors.rank.test.js, das genau deshalb eine ::warning-Zeile ausgibt). Skip ist nicht Pass.
 *
 * Usage:  node --test tests/input-hash.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { FIELD_REGISTRY } = require('../src/scoring/snapshot.js');
const { inputHash, serienFelder, KOHORTE_FELDER } = require('../lib/input-hash.js');

/** Ein Wert im Speicherformat, das das Register fuer dieses Feld vorschreibt. */
function serieFuer(format, faktor) {
  if (format === 'value') return [{ value: 100 * faktor }, { value: 90 * faktor }, { value: 80 * faktor }];
  if (format === 'scalar') return [10 * faktor, 9 * faktor, 8 * faktor];
  if (format === 'multikey') return [{ cash: 5 * faktor, totalDebt: 3 * faktor, totalAssets: 20 * faktor }];
  throw new Error(`unbekanntes Speicherformat "${format}" - Register erweitert, Probe nicht?`);
}

/** Vollbesetzter Snapshot: JEDES Register-Feld, aus dem Register erzeugt. */
function bauSnapshot(faktor = 1) {
  const s = {
    meta: { ticker: 'PROBE', sector: 'Technology', ipoYear: 2015, firstTradeDate: '2015-06-01T00:00:00.000Z',
      fetchedAt: '2026-08-23T00:00:00.000Z', reportingCurrency: 'USD' },
    marketCap: { value: 5e9, source: 'probe', asOf: '2026-08-23T00:00:00.000Z' },
    metrics: { priceSales: { value: 7 }, pe: { value: 20 } },
    annual: {}, timeseries: {},
  };
  for (const f of serienFelder()) {
    const [container, format] = FIELD_REGISTRY[f];
    s[container] = s[container] || {};
    s[container][f] = serieFuer(format, faktor);
  }
  return s;
}

test('das Register ist nicht leer und der Probe-Snapshot besetzt es vollstaendig', () => {
  const felder = serienFelder();
  assert.ok(felder.length >= 15, `nur ${felder.length} Register-Felder - Register geschrumpft?`);
  const h = inputHash(bauSnapshot());
  assert.equal(h.felder.length, felder.length,
    `${felder.length - h.felder.length} Register-Feld(er) kommen im Hash nicht an: `
    + felder.filter((f) => !h.felder.includes(f)).join(', '));
});

test('JEDES Register-Feld bewegt den Serien-Hash - Liste zur Laufzeit abgeleitet', () => {
  const basis = inputHash(bauSnapshot()).serienHash;
  const taub = [];
  for (const f of serienFelder()) {
    const s = bauSnapshot();
    const [container, format] = FIELD_REGISTRY[f];
    s[container][f] = serieFuer(format, 2);        // nur DIESES eine Feld anfassen
    if (inputHash(s).serienHash === basis) taub.push(f);
  }
  assert.deepEqual(taub, [],
    `Der inputHash ist blind fuer ${taub.length} Feld(er), die die Achsen lesen: ${taub.join(', ')}. `
    + 'Ein Feld im FIELD_REGISTRY, das den Hash nicht bewegt, macht die Drift-Zerlegung falsch: '
    + 'seine Aenderung wuerde als Lineal-Drift verbucht statt als Daten-Drift.');
});

test('ein fehlendes Feld bewegt den Hash genauso wie ein geaendertes', () => {
  const basis = inputHash(bauSnapshot()).serienHash;
  const taub = [];
  for (const f of serienFelder()) {
    const s = bauSnapshot();
    const [container] = FIELD_REGISTRY[f];
    delete s[container][f];
    if (inputHash(s).serienHash === basis) taub.push(f);
  }
  assert.deepEqual(taub, [], `Wegfall unbemerkt bei: ${taub.join(', ')}`);
});

test('Kursfelder bewegen den Serien-Hash NICHT (sonst zaehlt jeder Kurstick als Daten-Drift)', () => {
  const basis = inputHash(bauSnapshot()).serienHash;
  const s = bauSnapshot();
  s.meta.fetchedAt = '2099-12-31T00:00:00.000Z';
  s.metrics.priceSales = { value: 999 };
  s.metrics.pe = { value: 1 };
  s.marketCap.asOf = '2099-12-31T00:00:00.000Z';
  s.marketCap.value = 9e12;
  assert.equal(inputHash(s).serienHash, basis,
    'Ein Kurs-/Zeitfeld hat den Serien-Hash bewegt. Damit waere fast jede Zeile jeden Tag '
    + '"Daten-Drift" und die Zerlegung nutzlos - genau der Fehler, an dem der erste Messversuch scheiterte.');
});

test('jedes kohorten-bestimmende Feld bewegt den Kohorte-Hash und nur den', () => {
  const b = inputHash(bauSnapshot());
  const neu = { marketCap: 42, sector: 'Health Care', ipoYear: 1999, firstTradeDate: '1999-01-01T00:00:00.000Z' };
  for (const pfad of KOHORTE_FELDER) {
    const s = bauSnapshot();
    const blatt = pfad[pfad.length - 1];
    s[pfad[0]][blatt] = pfad[0] === 'marketCap' ? neu.marketCap : neu[blatt];
    const h = inputHash(s);
    assert.notEqual(h.kohorteHash, b.kohorteHash, `${pfad.join('.')} bewegt den Kohorte-Hash nicht`);
    assert.equal(h.serienHash, b.serienHash, `${pfad.join('.')} hat den SERIEN-Hash bewegt - die Trennung leckt`);
  }
});

test('der Hash ist deterministisch und unabhaengig von der Schluessel-Reihenfolge', () => {
  const a = bauSnapshot();
  // Container-Schluessel bewusst in umgekehrter Reihenfolge neu aufbauen.
  const b = bauSnapshot();
  for (const c of ['annual', 'timeseries']) {
    const umgedreht = {};
    for (const k of Object.keys(b[c]).reverse()) umgedreht[k] = b[c][k];
    b[c] = umgedreht;
  }
  assert.equal(inputHash(b).serienHash, inputHash(a).serienHash,
    'Der Hash haengt an der Schluessel-Reihenfolge - dann meldet ein blosser Umbau des Zusammenbaus Daten-Drift.');
  assert.equal(inputHash(a).gesamt, inputHash(bauSnapshot()).gesamt, 'nicht deterministisch');
});

test('secAnnual geht ein, ohne dass seine Schluessel von Hand gelistet werden', () => {
  const ohne = inputHash(bauSnapshot()).serienHash;
  const s = bauSnapshot();
  s.secAnnual = { annualRev: [{ value: 1 }], annualOpInc: [{ value: 2 }] };
  const mit = inputHash(s).serienHash;
  assert.notEqual(mit, ohne, 'secAnnual (von mergeSecIntoUniverse angehaengt) geht nicht in den Hash ein');
  const s2 = bauSnapshot();
  s2.secAnnual = { annualRev: [{ value: 1 }], annualOpInc: [{ value: 2 }], annualFCF: [{ value: 3 }] };
  assert.notEqual(inputHash(s2).serienHash, mit, 'ein ZUSAETZLICHER secAnnual-Schluessel bleibt unbemerkt');
});
