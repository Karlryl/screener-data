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
const { classifyTvCompleteness, formatTvPartialNotice, buildTvCompletenessWarnings } =
  require('../scripts/messung-entdeckungsband.js');

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

// Echte Produktions-Verkabelung ohne Netz: https.request liefert eine kontrollierte
// TradingView-Antwort. Damit beweist der Test nicht nur die reine Zeilenfunktion, sondern
// j.totalCount -> scanMarket -> m.partial -> discoverTvScanner -> merged.partial.
function scannerProduktionspfad(antwort) {
  const skript = `
    const { EventEmitter } = require('node:events');
    const https = require('node:https');
    const antwort = JSON.parse(process.argv[2]);
    https.request = (_url, _opts, callback) => {
      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.write = () => true;
      req.destroy = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        callback(res);
        process.nextTick(() => {
          res.emit('data', Buffer.from(JSON.stringify(antwort)));
          res.emit('end');
        });
      };
      return req;
    };
    const tv = require(process.argv[1]);
    const warnungen = [];
    console.log = () => {};
    console.warn = (meldung) => warnungen.push(String(meldung));
    (async () => {
      const einzel = await tv.scanMarket('tv-milan', tv.MARKETS['tv-milan'], { EUR: 1, USD: 1 });
      const gesamt = await tv.discoverTvScanner({ markets: ['tv-milan'] });
      process.stdout.write('###' + JSON.stringify({
        einzelPartial: einzel.partial === true,
        einzelGrund: einzel.partialReason,
        einzelCount: einzel.totalCount,
        einzelTorPartial: einzel.tor && einzel.tor.partial,
        gesamtPartial: gesamt.partial === true,
        warnungen,
      }));
    })().catch((error) => { process.stderr.write(String(error.stack || error)); process.exit(1); });`;
  const r = spawnSync(process.execPath, ['-e', skript, TV, JSON.stringify(antwort)],
    { env: process.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, 'hermetischer Produktionspfad fehlgeschlagen: ' + (r.stderr || '').slice(0, 500));
  const marker = String(r.stdout).indexOf('###');
  assert.ok(marker >= 0, 'Produktionspfad lieferte keine Ergebnisnutzlast');
  return JSON.parse(String(r.stdout).slice(marker + 3));
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
  assert.notEqual(m.partial, true, 'Vollstaendigkeit richtet sich nach gelieferten, nicht aufgenommenen Zeilen');
  assert.equal(m.tor.partial, false);
});

check('Client-Nachcut protokolliert NUR Groessen-Ausschluesse, nicht ETF/Vorzuege/Fremddomizil', () => {
  const etf = zeile('FONDS', 0.1e9); etf.d[4] = 'fund';
  const vz  = zeile('VORZUG', 0.1e9); vz.d[5] = 'preferred';
  const m = verarbeiteZeilen('tv-milan', CFG_IT, [etf, vz], RATEN, 2, 1.5e9);
  assert.equal(m.size, 0);
  assert.equal(m.tor.unterSchwelle.length, 0,
    'ein Fonds oder eine Vorzugsaktie ist kein zu klein befundenes Unternehmen');
});

// Review-Befund zum Erstwurf: alle Faelle oben rechnen mit Kurs 1. Dann ist die USD-Schwelle
// (MIN_USD_PRECUT) zahlengleich mit der lokalen Server-Schwelle (`right`) — beide heissen im
// selben Rumpf "die Schwelle", und ein Vertauschen blieb gruen. Real haette das jeden Markt
// mit Kurs != 1 (JP/KR/CN) fast vollstaendig geloescht: `right` liegt in Yen im Bereich 2e11,
// der verglichene Wert in USD im Bereich 2e9 -> alles faellt durch. Dieser Fall trennt beide.
const CFG_JP = { endpoint: 'japan', suffix: '.T', ccy: 'JPY', canon: 'tvjp', country: 'JP' };
const RATEN_JP = { JPY: 0.0067, USD: 1 };
const zeileJp = (code, mcapJpy) => ({ d: [code, mcapJpy, 'JPY', code + ' KK', 'stock', 'common', 'TSE', 'Japan'] });

check('Fremdwaehrung: verglichen wird der USD-Wert, NICHT die lokale Server-Schwelle', () => {
  // 300 Mrd JPY = 2,01 Mrd USD (drueber), 250 Mrd = 1,675 Mrd (drueber), 200 Mrd = 1,34 Mrd (drunter).
  // Die lokale Schwelle waere ~224 Mrd JPY — wer gegen SIE vergleicht, wirft alle drei weg.
  const m = verarbeiteZeilen('tv-japan', CFG_JP,
    [zeileJp('7203', 300e9), zeileJp('6758', 250e9), zeileJp('9999', 200e9)],
    RATEN_JP, 3, 223880597015);
  assert.deepEqual([...m.keys()].sort(), ['6758.T', '7203.T'],
    'beide USD-Werte ueber 1,5 Mrd muessen bleiben — sie liegen aber WEIT unter der lokalen Schwelle');
  assert.deepEqual(m.tor.unterSchwelle.map((r) => r.ticker), ['9999.T']);
  assert.equal(m.tor.unterSchwelle[0].mcapUsd, Math.round(200e9 * 0.0067));
});

check('abgeschnittener Markt wird als truncated gemeldet (stiller Verlust sichtbar)', () => {
  const m = verarbeiteZeilen('tv-japan', CFG_IT, [zeile('A', 3e9)], RATEN, 3100, 1.5e9);
  assert.equal(m.partial, true);
  assert.equal(m.partialReason, 'range-truncated');
  assert.equal(m.tor.partial, true);
  assert.equal(m.tor.truncated, true);
  assert.equal(m.tor.totalCount, 3100);
});

check('kleinste Abschneide-Differenz wird erkannt (Grenze ohne blinden Eintrag)', () => {
  const m = verarbeiteZeilen('tv-japan', CFG_IT, [zeile('A', 3e9)], RATEN, 2, 1.5e9);
  assert.equal(m.partial, true);
  assert.equal(m.partialReason, 'range-truncated');
  assert.equal(m.tor.truncated, true);
  assert.equal(m.tor.totalCount, 2);
});

check('vollstaendiger Markt ist NICHT truncated (Gegenprobe)', () => {
  const m = verarbeiteZeilen('tv-milan', CFG_IT, [zeile('A', 3e9)], RATEN, 1, 1.5e9);
  assert.notEqual(m.partial, true);
  assert.equal(m.partialReason, null);
  assert.equal(m.totalCount, 1, 'auch ein vollstaendiger gueltiger Zaehler bleibt erhalten');
  assert.equal(m.tor.partial, false);
  assert.equal(m.tor.truncated, false);
  assert.equal(m.tor.totalCount, 1);
});

check('fehlende oder ungueltige totalCount-Werte scheitern geschlossen', () => {
  const ungueltig = [undefined, null, '1', true, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
  for (const totalCount of ungueltig) {
    const m = verarbeiteZeilen('tv-milan', CFG_IT, [zeile('A', 3e9)], RATEN, totalCount, 1.5e9);
    const fall = `${typeof totalCount}:${String(totalCount)}`;
    assert.deepEqual([...m.keys()], ['A.MI'], `${fall}: gelieferte Zeilen duerfen nicht verloren gehen`);
    assert.equal(m.partial, true, `${fall}: Vollstaendigkeit ist nicht belegt`);
    assert.equal(m.partialReason, 'invalid-total-count', fall);
    assert.equal(m.totalCount, null, `${fall}: ungueltiger Rohwert darf nicht weitergereicht werden`);
    assert.equal(m.tor.partial, true, fall);
    assert.equal(m.tor.truncated, false, `${fall}: unbekannt ist nicht bewiesen abgeschnitten`);
    assert.equal(m.tor.partialReason, 'invalid-total-count', fall);
    assert.equal(m.tor.totalCount, null, fall);
  }

  const leerOhneZaehler = verarbeiteZeilen('tv-milan', CFG_IT, [], RATEN, undefined, 1.5e9);
  assert.equal(leerOhneZaehler.size, 0);
  assert.equal(leerOhneZaehler.partial, true,
    'eine leere Datenliste beweist ohne Rohzaehler keine echte Markt-Leere');
  assert.equal(leerOhneZaehler.partialReason, 'invalid-total-count');
  assert.equal(leerOhneZaehler.totalCount, null);
  assert.equal(leerOhneZaehler.tor.partial, true);
  assert.equal(leerOhneZaehler.tor.truncated, false);
});

check('totalCount kleiner als gelieferte Daten ist partiell, aber nicht truncated', () => {
  const m = verarbeiteZeilen('tv-milan', CFG_IT,
    [zeile('A', 3e9), zeile('B', 3e9)], RATEN, 1, 1.5e9);
  assert.deepEqual([...m.keys()], ['A.MI', 'B.MI'], 'beide gelieferten Zeilen bleiben erhalten');
  assert.equal(m.partial, true);
  assert.equal(m.partialReason, 'total-count-smaller-than-data');
  assert.equal(m.totalCount, 1, 'der gueltige, aber widerspruechliche Rohwert bleibt auditierbar');
  assert.equal(m.tor.partial, true);
  assert.equal(m.tor.truncated, false);
  assert.equal(m.tor.partialReason, 'total-count-smaller-than-data');
  assert.equal(m.tor.totalCount, 1);

  const nullGrenze = verarbeiteZeilen('tv-milan', CFG_IT, [zeile('A', 3e9)], RATEN, 0, 1.5e9);
  assert.deepEqual([...nullGrenze.keys()], ['A.MI']);
  assert.equal(nullGrenze.partial, true, '0 darf in Wahrheitspruefungen nicht als fehlend gelten');
  assert.equal(nullGrenze.partialReason, 'total-count-smaller-than-data');
  assert.equal(nullGrenze.totalCount, 0, 'der widerspruechliche Nullwert bleibt auditierbar');
  assert.equal(nullGrenze.tor.truncated, false);
});

check('leerer Markt mit totalCount 0 bleibt vollstaendig; sichere Obergrenze bleibt gueltig', () => {
  const leer = verarbeiteZeilen('tv-milan', CFG_IT, [], RATEN, 0, 1.5e9);
  assert.notEqual(leer.partial, true);
  assert.equal(leer.partialReason, null);
  assert.equal(leer.totalCount, 0);
  assert.equal(leer.tor.partial, false);
  assert.equal(leer.tor.truncated, false);

  const gross = verarbeiteZeilen('tv-milan', CFG_IT, [], RATEN, Number.MAX_SAFE_INTEGER, 1.5e9);
  assert.equal(gross.partial, true);
  assert.equal(gross.partialReason, 'range-truncated');
  assert.equal(gross.totalCount, Number.MAX_SAFE_INTEGER, 'kein erfundener operativer Hoechstwert');
  assert.equal(gross.tor.truncated, true);
});

check('Produktionspfad reicht fehlenden Rohzaehler bis zum Gesamtmarkt-Alarm durch', () => {
  const ergebnis = scannerProduktionspfad({
    data: [{ d: ['A', 3e9, 'EUR', 'A SpA', 'stock', 'common', 'MIL', 'Italy'] }],
    // totalCount fehlt absichtlich: j.data.length waere 1 und wuerde den Fehler verstecken.
  });
  assert.equal(ergebnis.einzelPartial, true);
  assert.equal(ergebnis.einzelGrund, 'invalid-total-count');
  assert.equal(ergebnis.einzelCount, null);
  assert.equal(ergebnis.einzelTorPartial, true);
  assert.equal(ergebnis.gesamtPartial, true, 'm.partial muss bis merged.partial hochgereicht werden');
  assert.equal(ergebnis.warnungen.length, 1);
  assert.match(ergebnis.warnungen[0], /incomplete or unverifiable scan/);
  assert.match(ergebnis.warnungen[0], /milan/);

  const leer = scannerProduktionspfad({ data: [] });
  assert.equal(leer.einzelPartial, true,
    'data:[] ohne totalCount darf nicht als bewiesen leer gelten');
  assert.equal(leer.einzelGrund, 'invalid-total-count');
  assert.equal(leer.einzelCount, null);
  assert.equal(leer.einzelTorPartial, true);
  assert.equal(leer.gesamtPartial, true);
  assert.equal(leer.warnungen.length, 1);
});

check('Mess-Serializer trennt beide Laeufe und bleibt zu alten Artefakten kompatibel', () => {
  const status = classifyTvCompleteness({
    gesund: { partialHeute: false, partialTief: false },
    alt: { partialHeute: true, partialTief: true },
    abgeschnittenHeute: { partialHeute: true, partialReasonHeute: 'range-truncated', partialTief: false },
    abgeschnittenTief: { partialHeute: false, partialTief: true, partialReasonTief: 'range-truncated' },
    ungueltigHeute: { partialHeute: true, partialReasonHeute: 'invalid-total-count', partialTief: false },
    widerspruchTief: { partialHeute: false, partialTief: true, partialReasonTief: 'total-count-smaller-than-data' },
  });
  assert.deepEqual(status.truncierteMaerkteHeute, ['alt', 'abgeschnittenHeute']);
  assert.deepEqual(status.truncierteMaerkteTief, ['alt', 'abgeschnittenTief']);
  assert.deepEqual(status.unverifizierbareMaerkteHeute, ['ungueltigHeute (invalid-total-count)']);
  assert.deepEqual(status.unverifizierbareMaerkteTief,
    ['widerspruchTief (total-count-smaller-than-data)']);

  assert.equal(formatTvPartialNotice(false, null, 'HEUTE'), '');
  assert.equal(formatTvPartialNotice(true, null, 'HEUTE'), '  HEUTE ABGESCHNITTEN');
  assert.equal(formatTvPartialNotice(true, 'range-truncated', 'TIEF'), '  TIEF ABGESCHNITTEN');
  assert.equal(formatTvPartialNotice(true, 'invalid-total-count', 'HEUTE'),
    '  HEUTE UNVERIFIZIERBAR (invalid-total-count)');
  assert.equal(formatTvPartialNotice(true, 'total-count-smaller-than-data', 'TIEF'),
    '  TIEF UNVERIFIZIERBAR (total-count-smaller-than-data)');

  const warnungen = buildTvCompletenessWarnings(status);
  assert.equal(warnungen.length, 4, 'Heute/Tief und abgeschnitten/unverifizierbar bleiben getrennt');
  assert.match(warnungen[0], /alt, abgeschnittenHeute/);
  assert.match(warnungen[0], /neu.*zu hoch/);
  assert.match(warnungen[1], /ungueltigHeute \(invalid-total-count\)/);
  assert.match(warnungen[1], /Richtung offen/);
  assert.match(warnungen[2], /alt, abgeschnittenTief/);
  assert.match(warnungen[2], /zu niedrig/);
  assert.match(warnungen[3], /widerspruchTief \(total-count-smaller-than-data\)/);
  assert.match(warnungen[3], /Richtung offen/);
  assert.deepEqual(buildTvCompletenessWarnings({}), [], 'alte gesunde Ergebnisartefakte bleiben lesbar');

  const quelle = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'scripts', 'messung-entdeckungsband.js'), 'utf8');
  assert.match(quelle, /partialReason:\s*m\.partialReason\s*\?\?\s*null/,
    'der Kindprozess muss den Grund aus dem Produktions-Map erhalten');
  assert.match(quelle, /totalCount:\s*m\.totalCount\s*\?\?\s*null/,
    'ein gueltiger Zaehler 0 darf nicht per Wahrheitspruefung verschwinden');
  assert.doesNotMatch(quelle, /totalCount:\s*m\.totalCount\s*\|\|\s*null/);
  assert.match(quelle, /partialReasonHeute:\s*h\.partialReason\s*\?\?\s*null/);
  assert.match(quelle, /partialReasonTief:\s*tief\[k\]\.partialReason\s*\?\?\s*null/);
  assert.match(quelle, /const tvVollstaendigkeit = classifyTvCompleteness\(tv\)/,
    'die getestete Klassifikation muss den Ergebnis-Pfad speisen');
  assert.match(quelle, /z\.push\(\.\.\.buildTvCompletenessWarnings\(e\)\)/,
    'die getesteten Warnungen muessen den Berichtspfad speisen');
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
  const verworfen = [];
  applyForeignPrefilterOutcome(allTickers, foreignNull,
    { kept, answered, renamed: new Map(), unpriceable: new Set(), belowUsd }, verworfen);
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
  const verworfen = [];
  applyForeignPrefilterOutcome(allTickers, [...allTickers.entries()],
    { kept: new Map(), answered: new Set(['X.PA']), renamed: new Map(), unpriceable: new Set() }, verworfen);
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

// ── Review-Befunde zum Erstwurf ──────────────────────────────────────────────────
check('drei Ausschlussgruende werden getrennt gefuehrt (nicht alles "unbekannt")', () => {
  const allTickers = new Map([
    ['KLEIN.MI', { ticker: 'KLEIN.MI', source: 'tvit', country: 'IT' }],
    ['FONDS.MI', { ticker: 'FONDS.MI', source: 'tvit', country: 'IT' }],
    ['STUMM.MI', { ticker: 'STUMM.MI', source: 'tvit', country: 'IT' }],
  ]);
  const verworfen = [];
  applyForeignPrefilterOutcome(allTickers, [...allTickers.entries()], {
    kept: new Map(),
    answered: new Set(['KLEIN.MI', 'FONDS.MI', 'STUMM.MI']),
    renamed: new Map(), unpriceable: new Set(),
    belowUsd: new Map([['KLEIN.MI', 0.6e9]]),
    nichtAktie: new Set(['FONDS.MI']),
  }, verworfen);
  const g = Object.fromEntries(verworfen.map((r) => [r.ticker, r.grund]));
  assert.equal(g['KLEIN.MI'], 'unter-schwelle');
  assert.equal(g['FONDS.MI'], 'kein-aktien-typ', 'ein Fonds ist kein zu klein befundenes Unternehmen');
  assert.equal(g['STUMM.MI'], 'ohne-marktwert');
  const p = baueAusschlussProtokoll([], verworfen, {});
  assert.equal(p.tor2_mcapPrefilter.jeQuelle.tvit.unterSchwelle, 1);
  assert.equal(p.tor2_mcapPrefilter.jeQuelle.tvit.keinAktienTyp, 1);
  assert.equal(p.tor2_mcapPrefilter.jeQuelle.tvit.ohneMarktwert, 1);
});

check('bricht die Zuordnung mitten ab, steht das bis dahin Geloeschte trotzdem im Protokoll', () => {
  // Das Protokoll wird HINEINGEREICHT, nicht zurueckgegeben. Sonst behauptet der aeussere
  // try/catch in main() "0 Ausschluesse", obwohl bereits Ticker aus allTickers weg sind.
  const allTickers = new Map([
    ['A.MI', { ticker: 'A.MI', source: 'tvit', country: 'IT' }],
    ['B.MI', { ticker: 'B.MI', source: 'tvit', country: 'IT' }],
  ]);
  const kaputt = { get(t) { if (t === 'B.MI') throw new Error('Zuordnung kaputt'); return undefined; } };
  const verworfen = [];
  assert.throws(() => applyForeignPrefilterOutcome(allTickers, [...allTickers.entries()],
    { kept: kaputt, answered: new Set(['A.MI', 'B.MI']), renamed: new Map(), unpriceable: new Set(), belowUsd: new Map() },
    verworfen));
  assert.equal(allTickers.has('A.MI'), false, 'A.MI wurde geloescht');
  assert.deepEqual(verworfen.map((r) => r.ticker), ['A.MI'],
    'die bereits erfolgte Loeschung MUSS im Protokoll stehen, auch wenn danach abgebrochen wird');
});

check('Protokoll behauptet keine Abruf-Schwelle, die dieser Prozess nicht kennt', () => {
  // Die Abruf-Schwelle (MIN_MCAP_USD) wird in einem anderen Workflow-Schritt gesetzt. Wer hier
  // den Vorgabewert 1 Mrd hinschreibt, dokumentiert eine Zahl, mit der der Tageslauf nicht
  // faehrt (er faehrt mit 800 Mio) — genau die Sorte Beleg, die spaeter falsch zitiert wird.
  const quelle = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'refresh-universe.js'), 'utf8');
  const zeile = quelle.match(/abruf_MIN_MCAP_USD:.*/);
  assert.ok(zeile, 'das Feld muss es geben');
  assert.ok(!/\|\|\s*'1e9'/.test(zeile[0]) && !/\|\|\s*'8e8'/.test(zeile[0]),
    'kein hartkodierter Ersatzwert — nicht gesetzt heisst null: ' + zeile[0]);
  assert.match(zeile[0], /:\s*null/, 'der Nicht-gesetzt-Fall muss null ergeben');
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
