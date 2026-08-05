#!/usr/bin/env node
/**
 * BA-SC-001 Stufe 1 — Waechter fuer den Nicht-Aktien-Namensfilter der TSX-Discovery.
 * ==================================================================================
 * Befund: das TMX-Vollregister listet neben Firmen auch Vehikel, die nie eine Aktie
 * werden koennen — CDRs, ETFs/ETNs, physische Metall-Treuhaender, Geldmarkt-/T-Bill-/
 * Anleihefonds. Gemessen 2026-08-03: 45 lagen im Bestand (watchlist.json, added_via~tsx),
 * 1336 von 3603 Registerzeilen sind solche Vehikel.
 *
 * Der Waechter haengt am ECHTEN Aufrufpfad (parseSheet mit einer Mini-XLSX-Fixture),
 * nicht am Regex-Literal: wer die Filterzeile aus parseSheet entfernt, wird rot —
 * ein Test, der nur NON_STOCK_NAME_RE anfasst, wuerde das nicht merken.
 *
 * Beidseitig:
 *   (a) CDR / ETF / Metall-Trust / Geldmarkt / T-Bill / Anleihefonds MUESSEN fliegen
 *   (b) REIT und operativer Trust-Mantel (Chemtrade-Klasse) MUESSEN bleiben —
 *       Stufe 2 (generisches Fund/Trust/REIT) ist bewusst NICHT gebaut
 *   (c) die Ertrags-Untergrenze feuert oberhalb der Schwelle und schweigt darunter
 *
 * Hermetisch: kein Netz, keine Dateien. Laeuft im pre-pull-Gate (tests/*test.js).
 */
'use strict';
const assert = require('assert');
const { fetchTsxCanada, parseSheet, nameFilterLines, NAME_FILTER_WARN_RATIO } = require('../discovery/tsx-ca');

// ── Mini-XLSX-Fixture ────────────────────────────────────────────────────────
// Genau die Form, die parseSheet aus der TMX-Mappe bekommt: Kopfzeile
// (Exchange / Name / Root Ticker) plus Datenzeilen. inlineStr-Zellen, damit die
// Fixture ohne sharedStrings-Tabelle auskommt.
const cell = (ref, val) => `<c r="${ref}" t="inlineStr"><is><t>${val}</t></is></c>`;
function sheetXml(rows) {
  const head = `<row r="1">${cell('A1', 'Exchange')}${cell('B1', 'Name')}${cell('C1', 'Root Ticker')}</row>`;
  const body = rows.map(([name, root], i) => {
    const r = i + 2;
    return `<row r="${r}">${cell('A' + r, 'TSX')}${cell('B' + r, name)}${cell('C' + r, root)}</row>`;
  }).join('');
  return `<sheetData>${head}${body}</sheetData>`;
}
function run(rows) {
  const result = new Map();
  const stats = { seen: 0, dropped: 0 };
  parseSheet(sheetXml(rows), [], result, stats);
  return { result, stats };
}

let fails = 0;
const check = (label, fn) => {
  try { fn(); }
  catch (e) { fails++; console.error('FAIL ' + label + ': ' + e.message); }
};

// ── (a) Positiv: die sechs Stufe-1-Klassen muessen fliegen ───────────────────
const FLIEGEN = [
  ['Apple CDR (CAD Hedged)',                      'AAPL', 'CDR'],
  ['BMO Ultra Short-Term US Bond ETF',            'ZUS',  'ETF'],
  ['Sprott Physical Gold Trust',                  'PHYS', 'physischer Metall-Treuhaender'],
  ['Purpose USD Cash Management Fund',            'MNU',  'Geldmarkt'],
  ['US Premium Cash Management Fund',             'MUSD', 'Geldmarkt (Vehikel-Wort direkt dahinter)'],
  ['Guardian Ultra-Short U.S. T-Bill Fund',       'GUTB', 'T-Bill'],
  ['Lysander-Canso U.S. Corporate Value Bond Fund', 'LYUV', 'Anleihefonds'],
];
check('Stufe-1-Vehikel fliegen', () => {
  const { result, stats } = run(FLIEGEN.map(([n, t]) => [n, t]));
  for (const [name, root, klasse] of FLIEGEN) {
    assert(!result.has(root + '.TO'),
      `${klasse} muss gedroppt werden, ist aber in der Discovery-Ausbeute: ${root}.TO "${name}"`);
  }
  assert.strictEqual(result.size, 0, 'kein Stufe-1-Vehikel darf durchkommen, durchgekommen: ' + [...result.keys()].join(','));
  assert.strictEqual(stats.dropped, FLIEGEN.length, `stats.dropped muss ${FLIEGEN.length} sein, ist ${stats.dropped}`);
  assert.strictEqual(stats.seen, FLIEGEN.length, `stats.seen muss ${FLIEGEN.length} sein, ist ${stats.seen}`);
});

// ── (b) Negativ: Stufe 2 bleibt unangetastet ─────────────────────────────────
// Ein generischer Fund/Trust/REIT-Filter wuerde operative Firmen im Trust-Mantel
// erschlagen. Diese Zeilen sind der Beleg, dass er NICHT gebaut wurde.
const BLEIBEN = [
  ['Canadian Apartment Properties Real Estate Investment Trust', 'CAR',  'REIT'],
  ['Chemtrade Logistics Income Fund',                            'CHE',  'operativer Trust-Mantel'],
  ['Boston Pizza Royalties Income Fund',                         'BPF',  'Royalty-Fonds mit operativem Geschaeft'],
  ['Precious Metals and Mining Trust',                           'MMP',  'Metall-Trust OHNE "Physical" (managed, keine Physik)'],
  ['Dream Impact Trust',                                         'MPCT', 'Impact-Trust'],
  ['Constellation Software Inc.',                                'CSU',  'gewoehnliche Firma'],
  // Tag 554: der Geldmarkt-Zweig band sein Vehikel-Wort nicht in Wortnaehe
  // (`(?=.*\b(?:Fund|Trust|Portfolio|Class)\b)` sah bis ans Zeilenende) und fuehrte
  // ausserdem "Class" als Vehikel-Wort — im TMX-Register ist das die
  // Aktiengattung, kein Fonds. Beide Zeilen matchten damit voll, obwohl der
  // Firmenname "Money Market"/"Cash Management" nur als Geschaeftsfeld traegt.
  // Im echten Register fielen sie nicht auf, weil die TMX-Namensspalte keine
  // Gattungs-Zusaetze fuehrt — die naechste Quelle, die es tut, haette sie geloescht.
  ['Meridian Money Market Innovations Inc., Class A Subordinate Voting Shares', 'MMKT', 'Firma mit "Money Market" im Namen, Vehikel-Wort weit entfernt'],
  ['Payfare Cash Management Solutions Inc. Class A',              'PAYF', 'Firma mit "Cash Management" im Namen, "Class" ist die Gattung'],
];
check('operative Firmen / REITs bleiben', () => {
  const { result, stats } = run(BLEIBEN.map(([n, t]) => [n, t]));
  for (const [name, root, klasse] of BLEIBEN) {
    assert(result.has(root + '.TO'),
      `${klasse} darf NICHT gedroppt werden (Stufe 2 ist verboten): ${root}.TO "${name}"`);
  }
  assert.strictEqual(stats.dropped, 0, 'Stufe 1 darf hier nichts droppen, gedroppt: ' + stats.dropped);
  assert.strictEqual(result.size, BLEIBEN.length, 'alle operativen Zeilen muessen durchkommen');
});

// ── (c) Ertrags-Untergrenze ──────────────────────────────────────────────────
check('Zaehlzeile wird immer gemeldet (kein stiller Drop)', () => {
  const lines = nameFilterLines(3, 20);
  assert(/3 von 20 gedroppt/.test(lines[0]), 'Zaehlzeile fehlt oder hat anderes Format: ' + lines[0]);
});
check('Warnschwelle schweigt im Normalfall', () => {
  // Gemessene Basis 2026-08-03: 1336/3603 = 37,1 % des Registers sind Vehikel.
  assert.strictEqual(nameFilterLines(1336, 3603).some(l => l.includes('::warning::')), false,
    'Normalstand (37,1 %) darf nicht warnen — sonst ist die Warnung wertlos');
  assert.strictEqual(nameFilterLines(55, 100).some(l => l.includes('::warning::')), false,
    'genau auf der Schwelle darf noch nicht gewarnt werden');
  assert.strictEqual(nameFilterLines(0, 0).some(l => l.includes('::warning::')), false,
    'leerer Lauf darf nicht warnen (Division durch 0)');
});
check('fetchTsxCanada meldet die Quote wirklich (nicht nur nameFilterLines existiert)', () => {
  // nameFilterLines allein zu pruefen wuerde nicht merken, wenn die Zeile im
  // Laufpfad geloescht wird — dann waere der Drop wieder still. Es gibt hier keinen
  // Test-Seam ohne Netz, also am benannten OBJEKT pruefen: der Rumpf von
  // fetchTsxCanada, nicht die ganze Datei (ein zweites Vorkommen anderswo darf
  // diesen Test nicht gruen halten).
  const src = require('fs').readFileSync(require.resolve('../discovery/tsx-ca.js'), 'utf8');
  const body = /async function fetchTsxCanada\s*\([\s\S]*?\n\}/.exec(src);
  assert(body, 'fetchTsxCanada nicht im Quelltext gefunden — Test-Anker kaputt, nicht der Code');
  assert(/nameFilterLines\s*\(/.test(body[0]),
    'fetchTsxCanada ruft nameFilterLines nicht auf — gefilterte Nicht-Aktien wuerden still verschwinden');
});

check('Warnschwelle feuert bei kuenstlich hoher Drop-Quote', () => {
  assert(nameFilterLines(56, 100).some(l => l.includes('::warning::')),
    'knapp ueber der Schwelle muss gewarnt werden');
  assert(nameFilterLines(99, 100).some(l => l.includes('::warning::')),
    '99 % Drop-Quote (Layout-Drift: Namensabgleich matcht auf alles) muss warnen');
  assert(NAME_FILTER_WARN_RATIO > 0.371 && NAME_FILTER_WARN_RATIO < 1,
    'Schwelle muss ueber dem gemessenen Normalstand (37,1 %) und unter 100 % liegen, ist ' + NAME_FILTER_WARN_RATIO);
});

(async () => {
  try {
    const logs = [];
    const entries = {
      'xl/worksheets/sheet1.xml': Buffer.from(sheetXml([
        ['Apple CDR (CAD Hedged)', 'AAPL'],
        ['Constellation Software Inc.', 'CSU'],
      ])),
      'xl/worksheets/sheet2.xml': Buffer.from(sheetXml([
        ['Shopify Inc.', 'SHOP'],
      ])),
    };
    const result = await fetchTsxCanada({
      get: async () => Buffer.alloc(0),
      readZipEntries: () => entries,
      log: line => logs.push(String(line)),
    });
    assert.equal(result.size, 2, 'Fixture muss genau die zwei Aktien liefern');
    assert.match(logs.join('\n'), /TSX-Namensfilter: 1 von 3 gedroppt/,
      'der echte fetchTsxCanada-Lauf muss die Filterquote melden');
    console.log('  ok   fetchTsxCanada meldet die Quote im echten Laufpfad');
  } catch (e) {
    fails++;
    console.error('FAIL fetchTsxCanada meldet die Quote im echten Laufpfad: ' + e.message);
  }
  if (fails) { console.error(`FAIL ba-sc-001-tsx-namensfilter: ${fails} Pruefung(en) rot`); process.exit(1); }
  console.log('PASS ba-sc-001-tsx-namensfilter: Stufe-1-Filter greift, Stufe 2 unangetastet, Ertrags-Untergrenze kalibriert');
})();
