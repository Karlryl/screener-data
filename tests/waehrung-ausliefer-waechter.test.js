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
    mcapBand: null, ipoRecency: null, profitTier: null, ipoYear: null, cohortN: 1, cohortFallback: false };
  let e = [];
  wx.validateBoardRow({ ...basis, marketCapCurrency: 'USD', tradingFxRateApplied: 0.127 }, 'w', e);
  assert.equal(e.length, 0, 'saubere Zeile muss durchgehen: ' + e.join('; '));
  e = []; wx.validateBoardRow({ ...basis, marketCapCurrency: 'HKD' }, 'w', e);
  assert.ok(e.some((x) => /marketCapCurrency/.test(x)), 'eine Nicht-USD-Einheit muss auffliegen');
  e = []; wx.validateBoardRow({ ...basis, tradingFxRateApplied: 'GARBAGE' }, 'w', e);
  assert.ok(e.some((x) => /tradingFxRateApplied/.test(x)), 'ein kaputter Stempel muss auffliegen');
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
  check('LIVE: unter ALLEN ausgelieferten (belegten) Beinen kein Kreuznotiz-Verstoss', () => {
    const v = kreuznotizVerstoesse(beine);
    console.log('       (' + beine.length + ' belegte Beine, davon ' +
      beine.filter((b) => b.gestempelt).length + ' mit Handelskurs-Stempel)');
    assert.equal(v.length, 0, v.map((x) => x.emittent + ' ' + (x.abweichung * 100).toFixed(1) + '% [' +
      x.beine.map((b) => b.ticker + '/' + b.tradingCurrency + '=' + (b.marketCap / 1e9).toFixed(2) + ' Mrd').join(',') + ']').join(' | '));
  });
}

console.log('\nwaehrung-ausliefer-waechter: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
