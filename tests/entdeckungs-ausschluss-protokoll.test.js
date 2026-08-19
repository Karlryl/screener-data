// Tag 642 — Waechter ueber die ZWEI Tore der Entdeckungs-Schicht und ihr Ausschluss-Protokoll.
//
// DER BEFUND, DEN DIESE DATEI FESTNAGELT: fuer die ~31 TradingView-Laender sind die
// Groessen-Schwellen IN REIHE geschaltet —
//   Tor 1  discovery/tv-scanner.js      TV_PRECUT_USD        (Vorgabe 1,5 Mrd)
//   Tor 2  discovery/mcap-prefilter.js  MCAP_PREFILTER_MIN_USD (Vorgabe 2 Mrd)
// Tor 1 laeuft ZUERST und filtert bereits auf dem TradingView-SERVER (serverFloor()
// uebersetzt die USD-Schwelle in die Listing-Waehrung und schickt sie als Filter mit).
// Wer nur Tor 2 senkt, aendert fuer diese Laender GAR NICHTS: die kleineren Namen kommen
// nie ueber die Leitung. Genau diese Falle hat die Uebergabe uebersehen, weil sie nur
// zwei der vier Schwellen des Repos kannte.
//
// Zweitens: bis Tag 642 verschwand jede an Tor 2 gescheiterte Auslandszeile per
// `allTickers.delete(eff)` OHNE Grund je Ticker. Das Protokoll ist Karls Direktive
// "nichts verschwindet" auf Datenebene — dieser Waechter haelt sie fest.
//
// Hermetisch: kein Netz (serverFloor ist genau deshalb aus scanMarket herausgezogen).
// Run: node tests/entdeckungs-ausschluss-protokoll.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { serverFloor, verarbeiteZeilen } = require('../discovery/tv-scanner.js');
const { applyForeignPrefilterOutcome, baueAusschlussProtokoll } = require('../refresh-universe.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// TV_PRECUT_USD wird beim LADEN des Moduls gelesen (const auf Modulebene). Ein ehrlicher
// Test dieser Ueberschreibbarkeit braucht deshalb einen eigenen Node-Prozess je Wert —
// require-Cache-Tricks wuerden etwas anderes messen als der echte Lauf tut.
const TV = path.join(__dirname, '..', 'discovery', 'tv-scanner.js');
function serverFloorMitEnv(wert, ccy, rate) {
  const r = spawnSync(process.execPath,
    ['-e', 'const t=require(process.argv[1]);console.log(t.serverFloor(process.argv[2],parseFloat(process.argv[3])))',
      TV, ccy, String(rate)],
    { env: Object.assign({}, process.env, { TV_PRECUT_USD: wert }), encoding: 'utf8' });
  assert.equal(r.status, 0, 'Kindprozess fehlgeschlagen: ' + (r.stderr || '').slice(0, 300));
  return parseFloat(String(r.stdout).trim());
}

// Hinweis: dass serverFloor() TV_PRECUT_USD ueberhaupt LIEST, prueft schon
// tests/scoring/bh-b14-discovery.test.js (BH-065). Hier geht es um die Folge davon —
// die Reihenschaltung mit Tor 2 und die Umrechnung in die Listing-Waehrung.
// ── Tor 1: die Schwelle ist per Umgebungsvariable steuerbar ──────────────────────
check('TV_PRECUT_USD steuert die Server-Schwelle wirklich (1,5 Mrd vs 800 Mio)', () => {
  const hoch = serverFloorMitEnv('1.5e9', 'USD', 1);
  const tief = serverFloorMitEnv('8e8', 'USD', 1);
  assert.equal(hoch, 1.5e9);
  assert.equal(tief, 8e8);
  assert.ok(tief < hoch, 'die beiden Werte MUESSEN sich unterscheiden, sonst beweist der Test nichts');
});

check('TV_PRECUT_USD wirkt auch in Fremdwaehrung (Schwelle wird umgerechnet)', () => {
  // EUR-Kurs 1.25 USD/EUR: 1,5 Mrd USD = 1,2 Mrd EUR; 800 Mio USD = 640 Mio EUR.
  assert.equal(serverFloorMitEnv('1.5e9', 'EUR', 1.25), 1.2e9);
  assert.equal(serverFloorMitEnv('8e8', 'EUR', 1.25), 6.4e8);
});

check('unbekannte Waehrung faellt auf 2 Mrd LOKAL zurueck (unveraendert)', () => {
  assert.equal(serverFloor('XXX', undefined), 2000000000);
});

// ── Die Reihenschaltung: der 1,2-Mrd-Titel stirbt heute an Tor 1, nicht an Tor 2 ──
check('Reihenschaltung: 1,2-Mrd-Titel erreicht Tor 2 heute GAR NICHT', () => {
  const tor1Heute = serverFloorMitEnv('1.5e9', 'USD', 1);
  assert.ok(1.2e9 < tor1Heute,
    'bei TV_PRECUT_USD=1,5 Mrd liegt ein 1,2-Mrd-Titel unter der Server-Schwelle — ' +
    'ein Absenken von MCAP_PREFILTER_MIN_USD allein kann ihn nicht zurueckholen');
});

check('Reihenschaltung: erst mit gesenktem Tor 1 kommt der 1,2-Mrd-Titel ueberhaupt an', () => {
  const tor1Neu = serverFloorMitEnv('8e8', 'USD', 1);
  assert.ok(1.2e9 >= tor1Neu, '1,2 Mrd muss die 800-Mio-Schwelle passieren');
  assert.ok(0.6e9 < tor1Neu, '600 Mio muss AUCH bei 800 Mio draussen bleiben (Karls Boden)');
});

// ── Tor 1, Client-Nachcut: die Zeilen-Bewertung ohne Netz ─────────────────────
// d = [code, mcap(Listing-Waehrung), ccy, name, type, subtype, exchange, country]
const zeile = (code, mcap, extra) => ({ d: Object.assign(
  [code, mcap, 'EUR', code + ' SpA', 'stock', 'common', 'MIL', 'Italy'], extra || {}) });
const CFG_IT = { endpoint: 'italy', suffix: '.MI', ccy: 'EUR', canon: 'tvit', country: 'IT' };
const RATEN = { EUR: 1, USD: 1 };

check('Client-Nachcut: 1,2-Mrd-Titel faellt bei 1,5-Mrd-Schwelle und steht im Protokoll', () => {
  const m = verarbeiteZeilen('tv-milan', CFG_IT,
    [zeile('GROSS', 3.0e9), zeile('BAND', 1.2e9), zeile('KLEIN', 0.6e9)], RATEN, 3, 1.5e9);
  // Die Vorgabe TV_PRECUT_USD ist 1,5 Mrd (Modulebene) — BAND und KLEIN liegen darunter.
  assert.deepEqual([...m.keys()], ['GROSS.MI']);
  assert.deepEqual(m.tor.unterSchwelle.map((r) => r.ticker).sort(), ['BAND.MI', 'KLEIN.MI']);
  const band = m.tor.unterSchwelle.find((r) => r.ticker === 'BAND.MI');
  assert.equal(band.mcapUsd, 1.2e9, 'der gemessene Marktwert ist die Begruendung');
  assert.equal(m.tor.geliefert, 3);
  assert.equal(m.tor.aufgenommen, 1);
});

check('Client-Nachcut protokolliert NUR Groessen-Ausschluesse, nicht ETF/Vorzuege/Fremddomizil', () => {
  const etf = zeile('FONDS', 0.1e9); etf.d[4] = 'fund';
  const vz  = zeile('VORZUG', 0.1e9); vz.d[5] = 'preferred';
  const m = verarbeiteZeilen('tv-milan', CFG_IT, [etf, vz], RATEN, 2, 1.5e9);
  assert.equal(m.size, 0);
  assert.equal(m.tor.unterSchwelle.length, 0,
    'ein Fonds oder eine Vorzugsaktie ist kein zu klein befundenes Unternehmen');
});

check('abgeschnittener Markt wird als truncated gemeldet (stiller Verlust sichtbar)', () => {
  const m = verarbeiteZeilen('tv-japan', CFG_IT, [zeile('A', 3e9)], RATEN, 3100, 1.5e9);
  assert.equal(m.tor.truncated, true);
  assert.equal(m.tor.totalCount, 3100);
});

check('vollstaendiger Markt ist NICHT truncated (Gegenprobe)', () => {
  const m = verarbeiteZeilen('tv-milan', CFG_IT, [zeile('A', 3e9)], RATEN, 1, 1.5e9);
  assert.equal(m.tor.truncated, false);
});

check('die wirksame Server-Schwelle steht im Protokoll (die Namen darunter kann niemand kennen)', () => {
  const m = verarbeiteZeilen('tv-milan', CFG_IT, [], RATEN, 0, 1234567890);
  assert.equal(m.tor.schwelleLokal, 1234567890);
  assert.equal(m.tor.schwelleUsd, 1.5e9, 'Vorgabe TV_PRECUT_USD');
  assert.equal(m.tor.markt, 'tv-milan');
});

// ── Tor 2: der Ausschluss wird protokolliert statt verschluckt ───────────────────
function laufTor2(minUsd) {
  // Kandidatenlage wie im echten Lauf: Auslandszeilen mit marketCap:null.
  const allTickers = new Map([
    ['GROSS.PA', { ticker: 'GROSS.PA', source: 'tvfr', country: 'FR' }],
    ['BAND.PA', { ticker: 'BAND.PA', source: 'tvfr', country: 'FR' }],
    ['KLEIN.MI', { ticker: 'KLEIN.MI', source: 'tvit', country: 'IT' }],
    ['STUMM.MI', { ticker: 'STUMM.MI', source: 'tvit', country: 'IT' }],
  ]);
  const foreignNull = [...allTickers.entries()];
  const mcap = { 'GROSS.PA': 3.0e9, 'BAND.PA': 1.2e9, 'KLEIN.MI': 0.6e9 };
  const kept = new Map(), belowUsd = new Map();
  for (const [t, v] of Object.entries(mcap)) (v >= minUsd ? kept : belowUsd).set(t, v);
  // STUMM.MI: beantwortet, aber ohne brauchbaren Marktwert -> muss als "unbekannt" landen.
  const answered = new Set([...Object.keys(mcap), 'STUMM.MI']);
  const verworfen = applyForeignPrefilterOutcome(allTickers, foreignNull,
    { kept, answered, renamed: new Map(), unpriceable: new Set(), belowUsd });
  return { allTickers, verworfen };
}

check('heute ($2 Mrd): drei Zeilen fliegen raus — und alle drei stehen im Protokoll', () => {
  const { allTickers, verworfen } = laufTor2(2e9);
  assert.deepEqual([...allTickers.keys()], ['GROSS.PA']);
  assert.deepEqual(verworfen.map((r) => r.ticker).sort(), ['BAND.PA', 'KLEIN.MI', 'STUMM.MI']);
  const band = verworfen.find((r) => r.ticker === 'BAND.PA');
  assert.equal(band.mcapUsd, 1.2e9, 'der gemessene Marktwert ist die Begruendung');
  assert.equal(band.quelle, 'tvfr');
  assert.equal(band.land, 'FR');
});

check('bei $800 Mio bleibt der 1,2-Mrd-Titel drin — das Protokoll schrumpft entsprechend', () => {
  const { allTickers, verworfen } = laufTor2(800e6);
  assert.ok(allTickers.has('BAND.PA'), 'BAND.PA muss bei $800 Mio ueberleben');
  assert.deepEqual(verworfen.map((r) => r.ticker).sort(), ['KLEIN.MI', 'STUMM.MI']);
});

check('ohne Marktwert steht "unbekannt" (null), nicht "0 Dollar"', () => {
  const { verworfen } = laufTor2(2e9);
  const stumm = verworfen.find((r) => r.ticker === 'STUMM.MI');
  assert.equal(stumm.mcapUsd, null);
});

check('fehlendes belowUsd (alte Aufrufform) kippt nicht in eine Falschzahl', () => {
  const allTickers = new Map([['X.PA', { ticker: 'X.PA', source: 'tvfr', country: 'FR' }]]);
  const verworfen = applyForeignPrefilterOutcome(allTickers, [...allTickers.entries()],
    { kept: new Map(), answered: new Set(['X.PA']), renamed: new Map(), unpriceable: new Set() });
  assert.equal(verworfen[0].mcapUsd, null);
});

// ── Das Protokoll-Objekt selbst ─────────────────────────────────────────────────
const TV_PROTOKOLL = [
  { markt: 'tv-milan', land: 'IT', waehrung: 'EUR', schwelleUsd: 1.5e9, schwelleLokal: 1.2e9,
    geliefert: 300, aufgenommen: 298, truncated: false, totalCount: 300,
    unterSchwelle: [{ ticker: 'RAND.MI', name: 'Rand SpA', mcapUsd: 1490000000 }] },
  { markt: 'tv-japan', land: 'JP', waehrung: 'JPY', schwelleUsd: 1.5e9, schwelleLokal: 225000000000,
    geliefert: 2500, aufgenommen: 2400, truncated: true, totalCount: 3100, unterSchwelle: [] },
];

check('Protokoll benennt beide Tore, ihre Schwellen und die Verworfenen', () => {
  const { verworfen } = laufTor2(2e9);
  const p = baueAusschlussProtokoll(TV_PROTOKOLL, verworfen,
    { tor1_TV_PRECUT_USD: 1.5e9, tor2_MCAP_PREFILTER_MIN_USD: 2e9 });
  assert.equal(p.schwellen.tor1_TV_PRECUT_USD, 1.5e9);
  assert.equal(p.schwellen.tor2_MCAP_PREFILTER_MIN_USD, 2e9);
  assert.equal(p.tor1_tvScannerVorschnitt.maerkte.length, 2);
  assert.equal(p.tor1_tvScannerVorschnitt.summeUnterSchwelleClient, 1);
  assert.deepEqual(p.tor1_tvScannerVorschnitt.truncierteMaerkte, ['tv-japan'],
    'ein abgeschnittener Markt ist ein WEITERER stiller Verlust und muss benannt sein');
  assert.equal(p.tor2_mcapPrefilter.summe, 3);
  assert.ok(p.tor2_mcapPrefilter.verworfen.some((r) => r.ticker === 'BAND.PA'));
});

check('jeQuelle zaehlt, wie viele Verworfene eine 800-Mio-Grenze gehalten haetten', () => {
  const { verworfen } = laufTor2(2e9);
  const p = baueAusschlussProtokoll(TV_PROTOKOLL, verworfen, {});
  // tvfr: nur BAND.PA (1,2 Mrd) -> haette gehalten. tvit: KLEIN.MI (600 Mio, nein) + STUMM.MI (unbekannt, nein).
  assert.equal(p.tor2_mcapPrefilter.jeQuelle.tvfr.verworfen, 1);
  assert.equal(p.tor2_mcapPrefilter.jeQuelle.tvfr.abAchthundertMio, 1);
  assert.equal(p.tor2_mcapPrefilter.jeQuelle.tvit.verworfen, 2);
  assert.equal(p.tor2_mcapPrefilter.jeQuelle.tvit.abAchthundertMio, 0,
    '600 Mio und "unbekannt" duerfen die 800-Mio-Ausbeute NICHT aufblasen');
});

check('leere Eingaben ergeben ein leeres, aber vollstaendiges Protokoll (kein Absturz)', () => {
  const p = baueAusschlussProtokoll(undefined, undefined, undefined);
  assert.equal(p.tor1_tvScannerVorschnitt.maerkte.length, 0);
  assert.equal(p.tor2_mcapPrefilter.summe, 0);
  assert.deepEqual(p.schwellen, {});
});

console.log(fail ? `\nentdeckungs-ausschluss-protokoll: ${fail} FAILED`
  : '\nentdeckungs-ausschluss-protokoll: all passed');
process.exit(fail ? 1 : 0);
