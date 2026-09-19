'use strict';
/**
 * Waehrungs-Waechter an der Ausliefer-Engstelle + Kreuznotiz-Dauerpruefung.
 * Waehrungs-Chunk 4 (16.08.2026, Karl-Freigabe).
 *
 * TEIL A — Ausliefer-Waechter (scripts/write-findash-export.js):
 *   Die Groesse einer Firma ist im Board eine USD-Aussage. Yahoo liefert marketCap aber in
 *   der HANDELS-Waehrung, und ob die Umrechnung stattgefunden hat, stand in der
 *   Auslieferung nirgends. Karls Regel: eine Zeile OHNE nachgewiesene Handelskurs-
 *   Umrechnung wird auf null gesetzt statt ausgeliefert — eine fehlende Groesse ist
 *   harmlos, eine falsche nicht.
 *
 * TEIL B — Kreuznotiz: derselbe Emittent in zwei Waehrungsnotizen muss dieselbe
 *   Marktkapitalisierung ergeben (Toleranz 3 %, deckt Kurs- und Zeitversatz ab).
 *   Die REGEL wird an Fixtures gepruefte (deterministisch, inkl. Ausbau-Probe). Der
 *   LIVE-Durchgang misst den vorhandenen Snapshot-Bestand.
 *
 *   Der Live-Durchgang prueft HART, was ausgeliefert wird — also alle Beine, die die
 *   Beleg-Regel oben durchlaesst (Review-Fix 16.08.). Frueher war er auf die
 *   GESTEMPELTEN Beine verengt, weil der Altbestand (Code-Staende vor dem 13.06.) an
 *   der alten, zu weichen Beleg-Regel vorbeikam und 23 Verstoesse in 27
 *   Kreuznotiz-Gruppen produzierte (alle .TO-Paare exakt +39,5 %, also der CAD-Kurs).
 *   Diese Zeilen nullt der Waechter jetzt selbst, statt sie auszuliefern — sie sind
 *   damit gar nicht mehr in der Pruefmenge, und der Zuschnitt ist ueberfluessig
 *   geworden. Am eingefrorenen lokalen Bestand (17.05.-08.06.): 1 668 belegte Beine,
 *   0 Verstoesse. Ein Verstoss ist ab jetzt ein rotes X — Karls einziger Alarmkanal.
 *
 * Usage:  node tests/waehrung-ausliefer-waechter.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const wx = require('../scripts/write-findash-export.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ---------------------------------------------------------------------------
// TEIL A1 — die Beweisfrage: wurde die marketCap dieser Zeile nach USD gebracht?
// ---------------------------------------------------------------------------
const B = wx.beurteileWaehrungsbeleg;

check('BELEGT: in USD gehandelt (nichts umzurechnen)', () => {
  const u = B({ reportingCurrencyOriginal: 'USD', tradingCurrency: 'USD', fxConverted: true, fxRateApplied: 1 });
  assert.equal(u.ok, true); assert.equal(u.grund, 'usd-gehandelt');
});

check('BELEGT: Handelskurs gestempelt (HK-Fall CNY/HKD nach dem Voll-Pull)', () => {
  const u = B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'HKD', tradingCurrencyOriginal: 'HKD',
    tradingFxRateApplied: 0.1274421, fxRateApplied: 0.14853986, fxConverted: true });
  assert.equal(u.ok, true); assert.equal(u.grund, 'handelskurs-gestempelt');
  assert.equal(u.rate, 0.1274421);
});

check('BELEGT: Handel = Bericht, vom heutigen Mapper BESTAETIGT', () => {
  const u = B({ reportingCurrencyOriginal: 'HKD', tradingCurrency: 'HKD', tradingCurrencyAssumed: false,
    fxConverted: true, fxRateApplied: 0.1274421 });
  assert.equal(u.ok, true); assert.equal(u.grund, 'identitaet');
});

check('UNBELEGT: Divergenz akzeptiert nur einen positiven endlichen Handelskurs-Stempel', () => {
  const invalid = [0, -0.5, NaN, Infinity, -Infinity, '0.127', null, undefined, true, {}, []];
  for (const tradingFxRateApplied of invalid) {
    const u = B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'HKD', tradingCurrencyOriginal: 'HKD',
      tradingFxRateApplied, fxConverted: true, fxRateApplied: 0.14853986 });
    assert.equal(u.ok, false, 'ungueltiger Handelskurs-Stempel wurde akzeptiert: ' + String(tradingFxRateApplied));
    assert.equal(u.grund, 'kein-handelskurs-nachweis');
    assert.equal(u.rate, null, 'ungueltiger Stempel darf nicht in die Auslieferung gelangen');
  }
});

check('UNBELEGT: bestaetigte Identitaet braucht ebenfalls einen positiven endlichen Kurs', () => {
  const invalid = [0, -0.5, NaN, Infinity, -Infinity, '0.127', null, undefined, true, {}, []];
  for (const fxRateApplied of invalid) {
    const u = B({ reportingCurrencyOriginal: 'HKD', tradingCurrency: 'HKD', tradingCurrencyAssumed: false,
      fxConverted: true, fxRateApplied });
    assert.equal(u.ok, false, 'ungueltiger Identitaetskurs wurde akzeptiert: ' + String(fxRateApplied));
    assert.equal(u.grund, 'kein-handelskurs-nachweis');
    assert.equal(u.rate, null);
  }
});

check('GEGENPROBE: USD-Handel braucht keinen FX-Kurs, ein unbrauchbarer Stempel wird nicht ausgeliefert', () => {
  const u = B({ reportingCurrencyOriginal: 'USD', tradingCurrency: 'USD',
    tradingFxRateApplied: 0, fxConverted: true, fxRateApplied: -1 });
  assert.equal(u.ok, true);
  assert.equal(u.grund, 'usd-gehandelt');
  assert.equal(u.rate, null);
});

check('GEGENPROBE: ADR in USD braucht trotz fremder Berichtswährung keinen FX-Kurs', () => {
  for (const tradingFxRateApplied of [undefined, 0]) {
    const u = B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'USD',
      tradingCurrencyAssumed: false, tradingFxRateApplied });
    assert.equal(u.ok, true, 'USD-Handel ist bereits die Zieleinheit, unabhaengig von der Berichtswährung');
    assert.equal(u.grund, 'usd-gehandelt');
    assert.equal(u.rate, null);
  }
});

check('UNBELEGT: ein nur geratener USD-Handel bleibt vor dem USD-Ausnahmepfad gesperrt', () => {
  const u = B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'USD',
    tradingCurrencyAssumed: true, tradingFxRateApplied: 1 });
  assert.equal(u.ok, false);
  assert.equal(u.grund, 'handelswaehrung-geraten');
  assert.equal(u.rate, 1);
});

check('UNBELEGT: Altbestand-Identitaet ohne Herkunfts-Feld (Review-Fix, KRITISCH)', () => {
  // DER Fall aus dem Bestand: vor Tag 938 setzte der Mapper die Handelswaehrung still gleich
  // der Berichtswaehrung, das Feld tradingCurrencyAssumed gab es noch nicht (undefined, NICHT
  // true). tc === rc ist hier kein Beleg fuer eine Inlandsnotierung, sondern das Symptom des
  // Wurzelfehlers — genau das Meta-Profil der 124 .HK-Zeilen vom 08.06. mit +16,6 % Groesse.
  const u = B({ reportingCurrencyOriginal: 'CNY', reportingCurrency: 'USD', tradingCurrency: 'CNY',
    fxConverted: true, fxRateApplied: 0.14853986 });
  assert.equal(u.ok, false, 'ein fehlendes Herkunfts-Feld ist eine Datenluecke, kein Beleg');
  assert.equal(u.grund, 'herkunft-unbekannt');
});

check('Ausbau-Probe: die Haertung trifft NUR die Identitaet, nicht die anderen Wege', () => {
  // Ohne Herkunfts-Feld, aber in USD gehandelt -> es gibt nichts umzurechnen (weiter belegt).
  assert.equal(B({ reportingCurrencyOriginal: 'USD', tradingCurrency: 'USD', fxConverted: true, fxRateApplied: 1 }).ok, true);
  // Ohne Herkunfts-Feld, aber mit Handelskurs-Stempel: der Stempel entsteht nur bei SICHTBARER
  // Divergenz — den Wurzelfehler (stille Gleichsetzung) kann er nicht erzeugen.
  assert.equal(B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'HKD', tradingCurrencyOriginal: 'HKD',
    tradingFxRateApplied: 0.1274421, fxConverted: true, fxRateApplied: 0.14853986 }).ok, true);
});

check('UNBELEGT: Handelswaehrung geraten (Yahoos price.currency fehlte)', () => {
  // Genau der Fall aus Waehrungs-Chunk 1: sieht aus wie eine Inlandsnotierung, ist aber
  // eine Gleichsetzung — die HKD-marketCap bekam den CNY-Kurs, +16,6 %.
  const u = B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'CNY', tradingCurrencyAssumed: true,
    fxConverted: true, fxRateApplied: 0.14853986 });
  assert.equal(u.ok, false); assert.equal(u.grund, 'handelswaehrung-geraten');
});

check('UNBELEGT: Divergenz ohne Stempel (Altbestand vor dem 13.06.)', () => {
  const u = B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'HKD', fxConverted: true, fxRateApplied: 0.14853986 });
  assert.equal(u.ok, false); assert.equal(u.grund, 'kein-handelskurs-nachweis');
});

check('UNBELEGT: keine Handelswaehrung im Snapshot / kein Snapshot', () => {
  assert.equal(B({ reportingCurrencyOriginal: 'CNY', fxConverted: true, fxRateApplied: 1 }).grund, 'handelswaehrung-unbekannt');
  assert.equal(B(null).grund, 'kein-snapshot');
});

check('UNBELEGT: Identitaet ohne vollzogene Umrechnung reicht NICHT', () => {
  // fxConverted fehlt -> der Snapshot behauptet gar keine Umrechnung. Nicht durchwinken.
  assert.equal(B({ reportingCurrencyOriginal: 'CNY', tradingCurrency: 'CNY', tradingCurrencyAssumed: false,
    fxRateApplied: 0.148 }).ok, false);
});

// ---------------------------------------------------------------------------
// TEIL A2 — die Verdrahtung: fuehrt der Zeilen-Mapper die Regel wirklich aus?
// Im Testlauf ist snapshots/ leer -> jede Zeile ist unbelegt -> Groesse muss fallen.
// ---------------------------------------------------------------------------
check('mapBoardRow: unbelegte Zeile verliert die Groesse, behaelt die Einheit', () => {
  const zeile = wx.mapBoardRow({ ticker: 'ZZTESTZZ', score: 50, track: 'profitable', lamps: [],
    overview: null, marketCap: 12345678901, name: 'Test AG' }, 0);
  assert.equal(zeile.marketCapCurrency, 'USD', 'die Einheit des Feldes ist immer USD');
  assert.ok('tradingFxRateApplied' in zeile, 'der Stempel muss mitgefuehrt werden');
  assert.equal(zeile.marketCap, null,
    'ohne Handelskurs-Nachweis darf keine Groesse ausgeliefert werden');
});

check('mapOverviewRow und mapSurvivalRow tragen dieselbe Regel', () => {
  const o = wx.mapOverviewRow({ ticker: 'ZZTESTZZ', formulaId: 'x', track: 'profitable', score: 1,
    overviewKind: null, overviewValue: null, overviewCompanion: null, lamps: [], marketCap: 9e9 }, 0);
  assert.equal(o.marketCap, null); assert.equal(o.marketCapCurrency, 'USD');
  const s = wx.mapSurvivalRow({ ticker: 'ZZTESTZZ', runwayQuarters: 4, lamps: [], marketCap: 9e9 }, 0);
  assert.equal(s.marketCap, null); assert.equal(s.marketCapCurrency, 'USD');
});

check('--check akzeptiert die neuen Felder und faengt einen falschen Wert', () => {
  const basis = { ticker: 'X', score: 1, rank: 1, track: 'profitable', lamps: [], overview: null,
    name: 'X', country: null, region: null, sector: null, marketCap: null, phase: null,
    mcapBand: null, ipoRecency: null, profitTier: null, ipoYear: null, cohortN: 1, cohortFallback: false,
    coverageAxes: '7/7' }; // 18.08.: Belegbarkeits-Gate — nur belegte Zeilen tragen einen Rang
  let e = [];
  wx.validateBoardRow({ ...basis, marketCapCurrency: 'USD', tradingFxRateApplied: 0.127 }, 'w', e);
  assert.equal(e.length, 0, 'saubere Zeile muss durchgehen: ' + e.join('; '));
  e = []; wx.validateBoardRow({ ...basis, marketCapCurrency: 'USD', tradingFxRateApplied: null }, 'w', e);
  assert.equal(e.length, 0, 'null bleibt fuer einen nicht gemessenen optionalen Stempel legitim: ' + e.join('; '));
  e = []; wx.validateBoardRow({ ...basis, revGrowthYoYPct: -10 }, 'w', e);
  assert.equal(e.length, 0, 'negative Wachstumsanzeigen bleiben legitim; die Positivregel gilt nur fuer FX-Belege');
  e = []; wx.validateBoardRow({ ...basis, marketCapCurrency: 'HKD' }, 'w', e);
  assert.ok(e.some((x) => /marketCapCurrency/.test(x)), 'eine Nicht-USD-Einheit muss auffliegen');
  for (const bad of [0, -0.5, NaN, Infinity, -Infinity, 'GARBAGE', true, {}, []]) {
    e = []; wx.validateBoardRow({ ...basis, tradingFxRateApplied: bad }, 'w', e);
    assert.ok(e.some((x) => /tradingFxRateApplied/.test(x)),
      'ein unbrauchbarer Stempel muss auffliegen: ' + String(bad));
  }
  e = []; wx.validateBoardRow(basis, 'w', e);
  assert.equal(e.length, 0, 'Abwesenheit bleibt legitim (Altbestands-Export darf nicht rot werden)');
});

check('Massen-Nullung bricht den Export ab, statt halbblind auszuliefern', () => {
  assert.equal(wx.waehrungsWaechterUrteil(1000, 10).abbruch, false, '1 % ist Normalbetrieb');
  assert.equal(wx.waehrungsWaechterUrteil(1000, 500).abbruch, true, '50 % ist ein Schema-Bruch');
  assert.equal(wx.waehrungsWaechterUrteil(0, 0).abbruch, false, 'leerer Lauf bricht nicht ab');
  assert.ok(wx.NULL_ANTEIL_STOPP > 0 && wx.NULL_ANTEIL_STOPP < 1);
});

// ---------------------------------------------------------------------------
// TEIL B1 — die Kreuznotiz-REGEL an Fixtures. Toleranz 3 %.
// ---------------------------------------------------------------------------
const TOLERANZ = 0.03;

// Emittenten-Schluessel bewusst STRENG und hier selbst gebaut: ein Waechter, der denselben
// Schluessel benutzt wie der Dedup in src/scoring/score.js, prueft nur sich selbst.
function emittentSchluessel(name) {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim().toLowerCase();
  return n.length >= 4 ? n : null;
}

// Gibt die Gruppen zurueck, die die 3-%-Regel verletzen.
function kreuznotizVerstoesse(beine, toleranz = TOLERANZ) {
  const grp = new Map();
  for (const b of beine) {
    const k = emittentSchluessel(b.name);
    if (!k || !Number.isFinite(b.marketCap) || b.marketCap <= 0 || !b.tradingCurrency) continue;
    if (!grp.has(k)) grp.set(k, []);
    grp.get(k).push(b);
  }
  const out = [];
  for (const [k, arr] of grp) {
    if (arr.length < 2) continue;
    // NUR echte Waehrungs-Kreuznotizen: zwei Beine in derselben Waehrung sagen nichts
    // ueber die Umrechnung aus.
    if (new Set(arr.map((x) => String(x.tradingCurrency).toUpperCase())).size < 2) continue;
    const werte = arr.map((x) => x.marketCap);
    const abw = (Math.max(...werte) - Math.min(...werte)) / Math.min(...werte);
    if (abw > toleranz) out.push({ emittent: k, abweichung: abw, beine: arr });
  }
  return out;
}

const HKD = 0.1274421, CNY = 0.14853986;
// Ein Emittent, zwei Notierungen: Hongkong (HKD) und Festland (CNY). Beide Beine korrekt
// umgerechnet -> dieselbe USD-Groesse.
const ROH_HK = 56925810688;                  // HKD
const ROH_CN = ROH_HK * HKD / CNY;           // dieselbe Firma, in CNY notiert
function beinePaar(mcapHk, mcapCn) {
  return [
    { ticker: '0020.HK', name: 'Muster Group Inc.', tradingCurrency: 'HKD', marketCap: mcapHk },
    { ticker: '600020.SS', name: 'Muster Group Inc.', tradingCurrency: 'CNY', marketCap: mcapCn },
  ];
}

check('Kreuznotiz: korrekt umgerechnete Beine stimmen ueberein', () => {
  const v = kreuznotizVerstoesse(beinePaar(ROH_HK * HKD, ROH_CN * CNY));
  assert.equal(v.length, 0, 'kein Verstoss erwartet, gefunden: ' + JSON.stringify(v.map((x) => x.abweichung)));
});

check('AUSBAU-PROBE: ein mit dem falschen Kurs skaliertes Bein wird rot', () => {
  // Genau der Schaden aus Chunk 1: das HK-Bein bekommt den CNY-Berichtskurs statt des
  // HKD-Handelskurses. Das sind +16,6 % — weit ueber der 3-%-Toleranz.
  const v = kreuznotizVerstoesse(beinePaar(ROH_HK * CNY, ROH_CN * CNY));
  assert.equal(v.length, 1, 'der verfaelschte Wert MUSS auffliegen');
  assert.ok(v[0].abweichung > 0.16 && v[0].abweichung < 0.17,
    'Abweichung muss dem Kursverhaeltnis entsprechen, ist ' + v[0].abweichung);
});

check('AUSBAU-PROBE: ein gar nicht umgerechnetes Bein wird rot', () => {
  const v = kreuznotizVerstoesse(beinePaar(ROH_HK, ROH_CN * CNY));
  assert.equal(v.length, 1);
  assert.ok(v[0].abweichung > 6, 'unumgerechnet ist um den Kehrwert des Kurses daneben');
});

check('Toleranz: 3 % Kurs-/Zeitversatz gilt NICHT als Verstoss, 3,5 % schon', () => {
  assert.equal(kreuznotizVerstoesse(beinePaar(100e9, 102.9e9)).length, 0);
  assert.equal(kreuznotizVerstoesse(beinePaar(100e9, 103.5e9)).length, 1);
});

check('Ein Bein allein oder zwei Beine derselben Waehrung loesen nichts aus', () => {
  assert.equal(kreuznotizVerstoesse([{ ticker: 'A', name: 'Muster Group Inc.', tradingCurrency: 'USD', marketCap: 1e9 }]).length, 0);
  assert.equal(kreuznotizVerstoesse([
    { ticker: 'A', name: 'Muster Group Inc.', tradingCurrency: 'USD', marketCap: 1e9 },
    { ticker: 'B', name: 'Muster Group Inc.', tradingCurrency: 'USD', marketCap: 9e9 },
  ]).length, 0, 'gleiche Waehrung sagt nichts ueber die Umrechnung aus');
});

// ---------------------------------------------------------------------------
// TEIL B2 — LIVE gegen den vorhandenen Snapshot-Bestand, ohne externe Daten.
// Hart nur fuer Beine, die der heutige Code erzeugt hat (Handelskurs-Stempel gesetzt);
// alles andere wird vollstaendig aufgelistet.
// ---------------------------------------------------------------------------
const SNAP_DIR = path.join(__dirname, '..', 'snapshots');
function ladeBeine() {
  let dateien = [];
  try { dateien = fs.readdirSync(SNAP_DIR); } catch (_) { return null; }
  const beine = [];
  for (const f of dateien) {
    // NICHT pauschal jedes '_'-Praefix wegwerfen: safeSnapshotFilename praefixt
    // Windows-reservierte Ticker (_CON.json ist ein ECHTER Snapshot). Waechter darueber:
    // tests/p1-welle8-metadata-filter.test.js.
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch (_) { continue; }
    const m = s && s.meta;
    if (!m || m.delisted) continue;
    const mc = s.marketCap && Number.isFinite(s.marketCap.value) ? s.marketCap.value : null;
    if (!mc) continue;
    // OTC-Schattenbeine raus: Yahoos marketCap ist dort notorisch unbrauchbar (bei
    // MBFJF/TOYOF/HTHIF um Faktor 150 daneben) — das ist keine Waehrungsfrage.
    if (/otc|pink|pnk/i.test(m.exchangeName || '')) continue;
    if (!wx.beurteileWaehrungsbeleg(m).ok) continue;
    beine.push({ ticker: m.ticker || f, name: m.name, marketCap: mc,
      tradingCurrency: m.tradingCurrencyOriginal || m.tradingCurrency,
      gestempelt: Number.isFinite(m.tradingFxRateApplied) });
  }
  return beine;
}

const beine = ladeBeine();
if (!beine || beine.length === 0) {
  console.warn('::warning::waehrung-ausliefer-waechter: kein Snapshot-Bestand vorhanden — ' +
    'der LIVE-Kreuznotiz-Durchgang wurde NICHT gemessen. Die Regel selbst ist oben an ' +
    'Fixtures geprueft; dieser Lauf sagt nichts ueber den echten Bestand aus.');
} else {
  // Review-Fix 16.08. (MITTEL): HART ueber ALLE belegten Beine, nicht nur die gestempelten.
  // Der alte Zuschnitt (nur `gestempelt`) liess genau die Zeilen aus der Pruefung fallen, die
  // die gehaertete Beleg-Regel jetzt gar nicht mehr durchlaesst — sie landeten bestenfalls in
  // einem ::warning::, und Karls einziger Alarmkanal ist das rote X, nicht ein Log-Hinweis.
  // Nach der Haertung ist "belegt" = "wird ausgeliefert": die Pruefmenge ist damit exakt die
  // Menge, die Karl zu sehen bekommt. Am eingefrorenen Bestand (17.05.-08.06.) sind das
  // 1 668 Beine mit 0 Verstoessen — das Gate ist an echten Daten gruen, nicht per Zuschnitt.
  // A/H-Ausnahme (Vorsitz-Entscheid 19.09.2026, ~75 %, revidierbar im Sonntags-Brief):
  // Die Gleichheits-Annahme "ein Emittent, eine Groesse" ist fuer chinesische A/H-Doppel-
  // notierungen SACHLICH falsch. A-Aktien (Festland, CNY, .SS/.SZ) und H-Aktien (Hongkong,
  // HKD) sind durch Kapitalverkehrskontrollen getrennte Maerkte; der A/H-Aufschlag ist ein
  // reales Marktphaenomen, kein Umrechnungsfehler. Gemessen am Bestand vom 19.09.: von 384
  // Gruppen waren 13 ein echter Defekt (GBp-Altwerte, 100x) und der Rest ganz ueberwiegend
  // genau dieser Aufschlag.
  //
  // Der Schnitt sitzt BEWUSST hier am Live-Aufruf und NICHT in kreuznotizVerstoesse(): die
  // Fixture-Positivkontrolle oben ("korrekt umgerechnete Beine stimmen ueberein", Z. 255) ist
  // selbst als HK/SS-Paar gebaut. Ein Filter in der Funktion haette genau diese Kontrolle
  // entwertet — ein gruener Test, der nichts mehr feststellen kann.
  //
  // Entfernt wird NUR das A-Bein, und nur wenn der Emittent ueberhaupt ein Nicht-CNY-Bein hat.
  // Alles andere bleibt in der Gleichheits-Annahme: ADR-Beine (nach Verhaeltnis), EUR-, USD-,
  // GBp-Beine. Bei ZTE etwa bleiben 0763.HK/HKD und FZM.VI/EUR gegeneinander geprueft — nur
  // 000063.SZ/CNY faellt heraus.
  const istABein = (b) => /^\d{6}\.(SS|SZ)$/.test(String(b.ticker || '')) &&
    String(b.tradingCurrency || '').toUpperCase() === 'CNY';
  const nachEmittent = new Map();
  for (const b of beine) {
    const k = emittentSchluessel(b.name);
    if (!k) continue;
    if (!nachEmittent.has(k)) nachEmittent.set(k, []);
    nachEmittent.get(k).push(b);
  }
  const ahAufschlaege = [];
  const beineOhneA = beine.filter((b) => {
    if (!istABein(b)) return true;
    const gruppe = nachEmittent.get(emittentSchluessel(b.name)) || [];
    const fremd = gruppe.filter((x) => String(x.tradingCurrency || '').toUpperCase() !== 'CNY' &&
      Number.isFinite(x.marketCap) && x.marketCap > 0);
    if (!fremd.length) return true;   // kein Gegenbein -> nichts auszunehmen
    const h = Math.max(...fremd.map((x) => x.marketCap));
    ahAufschlaege.push({ emittent: emittentSchluessel(b.name), aufschlag: (b.marketCap - h) / h });
    return false;
  });

  // Schwaechere Zusicherung fuer die ausgenommenen Paare: der Aufschlag wird als ZAHL
  // berichtet, nicht behauptet. Geprueft wird nur, dass beide Beine ueberhaupt eine
  // brauchbare, gleich normalisierte Groesse tragen — faellt ein Bein auf 0 oder NaN,
  // ist das kein Aufschlag mehr, sondern ein Datenfehler, und der bleibt rot.
  check('A/H-Doppelnotierungen: Aufschlag wird berichtet, beide Beine bleiben brauchbar', () => {
    const kaputt = ahAufschlaege.filter((x) => !Number.isFinite(x.aufschlag) || x.aufschlag <= -1);
    const sortiert = [...ahAufschlaege].sort((a, b) => b.aufschlag - a.aufschlag);
    console.log('       (' + ahAufschlaege.length + ' A/H-Paare ausgenommen; Aufschlag Median ' +
      (sortiert.length ? (sortiert[Math.floor(sortiert.length / 2)].aufschlag * 100).toFixed(1) : 'n/a') +
      ' %, Spanne ' + (sortiert.length ? (sortiert[sortiert.length - 1].aufschlag * 100).toFixed(1) +
      ' bis ' + (sortiert[0].aufschlag * 100).toFixed(1) : 'n/a') + ' %)');
    assert.equal(kaputt.length, 0, 'A/H-Bein ohne brauchbare Groesse: ' +
      kaputt.map((x) => x.emittent + ' ' + x.aufschlag).join(', '));
  });

  // Zuschnitt des Live-Blocks (Vorsitz-Entscheid 19.09.2026, ~75 %, revidierbar im
  // Sonntags-Brief): Dieser Waechter existiert fuer den SKALEN-Fehler — Pence 100x, eine
  // vergessene KRW/JPY/HKD/INR/TWD-Umrechnung — nicht fuer den Aufschlag. Eine 3-%-Latte
  // auf 15.000 Live-Namen misst dagegen Zweitnotierungs-Versatz, ADR-Bezugsverhaeltnisse
  // und Vorzugsaktien: am 19.09. blieben nach der A/H-Ausnahme 229 Gruppen uebrig, von
  // denen KEINE ein Umrechnungsfehler war. Ein dauerhaft roter Waechter wird nicht gelesen.
  //
  // Hart behauptet wird deshalb nur noch, was ausserhalb von [0,5 ; 2,0] liegt. Alles
  // darunter wird als Verteilung BERICHTET, nie behauptet. Die 3-%-Latte lebt unveraendert
  // in den Fixture-Kontrollen oben weiter — dort ist sie richtig, weil dort die Umrechnung
  // selbst geprueft wird und nicht der Markt.
  const SKALEN_UNTEN = 0.5, SKALEN_OBEN = 2.0;
  const alleGruppen = kreuznotizVerstoesse(beineOhneA, 0);   // Toleranz 0 -> jede Gruppe mit Spreizung
  // Zwei gemeldete Klassen innerhalb der Skalen-Spanne (Vorsitz-Entscheid 19.09.2026):
  //  - Vorzugsaktien: Yahoos `-P?`-Suffix (ALL-PH, WFC-PC) ist eine ANDERE Gattung mit
  //    eigenem Kurs und eigener Stueckzahl, kein Umrechnungsfehler.
  //  - ADR/GDR-Zweitlinien: Yahoo fuehrt fuer die Zweitlinie eine eigene, oft nicht auf die
  //    Primaerlinie umgerechnete Groesse. Das ist Yahoos Zahl fuer diese Linie, nicht unsere
  //    Umrechnung — gemeldet MIT Namen, nicht behauptet.
  // Die Grenze zwischen "Zweitlinie uneinig" und "Skala kaputt" ist die Groessenordnung:
  // die gemessenen Zweitlinien lagen bei 2x bis 8x, SMCI.SW bei ~865x. Alles ueber 10x
  // bleibt eine harte Behauptung — dort ist keine Bezugsgroesse mehr erklaerbar.
  const SEKUNDAER_MAX = 10;
  const istVorzug = (b) => /-P[A-Z]?$/.test(String(b.ticker || ''));
  const skalenVerstoesse = [], versatz = [], vorzug = [], sekundaer = [];
  for (const g of alleGruppen) {
    const werte = g.beine.map((b) => b.marketCap);
    const q = Math.max(...werte) / Math.min(...werte);
    if (q >= SKALEN_UNTEN && q <= SKALEN_OBEN) { versatz.push({ g, q }); continue; }
    if (g.beine.some(istVorzug)) { vorzug.push({ g, q }); continue; }
    if (q <= SEKUNDAER_MAX) { sekundaer.push({ g, q }); continue; }
    skalenVerstoesse.push({ g, q });
  }

  check('Vorzugsaktien und ADR-Zweitlinien werden gemeldet, nicht behauptet', () => {
    const zeig = (arr) => arr.map((x) => x.g.emittent + ' ' + x.q.toFixed(2) + 'x [' +
      x.g.beine.map((b) => b.ticker).join(',') + ']').join(' | ') || 'keine';
    console.log('       (Vorzugsaktien, ' + vorzug.length + ': ' + zeig(vorzug) + ')');
    console.log('       (ADR/GDR-Zweitlinien bis ' + SEKUNDAER_MAX + 'x, ' + sekundaer.length +
      ': ' + zeig(sekundaer) + ')');
    assert.ok(true);
  });

  check('LIVE: Versatz-Verteilung wird berichtet (nicht behauptet)', () => {
    const qs = versatz.map((x) => x.q).sort((a, b) => a - b);
    const pick = (p) => (qs.length ? qs[Math.min(qs.length - 1, Math.floor(p * qs.length))] : NaN);
    const schlimmste = [...versatz].sort((a, b) => b.q - a.q).slice(0, 3);
    console.log('       (' + versatz.length + ' Gruppen innerhalb [0,5;2,0]: Median ' +
      pick(0.5).toFixed(2) + 'x, p90 ' + pick(0.9).toFixed(2) + 'x; schlimmste: ' +
      (schlimmste.map((x) => x.g.emittent + ' ' + x.q.toFixed(2) + 'x').join(', ') || 'keine') + ')');
    // BLINDER FLECK, ausdruecklich gedruckt: eine vergessene Umrechnung fuer Waehrungen, die
    // unter 2 je USD notieren (EUR, GBP, CHF, CAD, AUD, SGD, NZD), liegt INNERHALB von
    // [0,5;2,0] und kommt durch dieses Tor. Der Pence-Fall (100x) wird weiter gefangen.
    console.log('       (BLINDER FLECK: vergessene Umrechnung bei EUR/GBP/CHF/CAD/AUD/SGD/NZD ' +
      'liegt innerhalb [0,5;2,0] und passiert dieses Tor — Pence 100x wird gefangen.)');
    assert.ok(true);
  });

  check('LIVE: kein SKALEN-Fehler — kein Beinpaar ausserhalb [0,5 ; 2,0]', () => {
    const v = skalenVerstoesse.map((x) => x.g);
    console.log('       (' + beine.length + ' belegte Beine, davon ' +
      beine.filter((b) => b.gestempelt).length + ' mit Handelskurs-Stempel)');
    assert.equal(v.length, 0, v.map((x) => x.emittent + ' ' + (x.abweichung * 100).toFixed(1) + '% [' +
      x.beine.map((b) => b.ticker + '/' + b.tradingCurrency + '=' + (b.marketCap / 1e9).toFixed(2) + ' Mrd').join(',') + ']').join(' | '));
  });
}

console.log('\nwaehrung-ausliefer-waechter: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
