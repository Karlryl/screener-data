'use strict';
/**
 * Waechter tag229a — das Diagnose-Werkzeug misst DASSELBE wie die Produktion.
 *
 * BEFUND (T181-Messung §6.2, nachgemessen 2026-08-30 ueber 15.046 Snapshots):
 * `scripts/tag229a-stale-snapshot-verify.js` trug eine KOPIE des Schema-Melders, und
 * die Kopie war abgedriftet. Sie las `Number.isFinite(bal[0].currentAssets)`, waehrend
 * die Produktion seit dem Bug-13-Fix (2026-07-03) `'currentAssets' in bal[0]` prueft —
 * Schluessel-ANWESENHEIT statt finitem Wert:
 *
 *     Produktion  pull-yahoo.js    149 schema-stale
 *     Spiegel     tag229a-…       1719 schema-stale     11,54x · 1.570 zu viel
 *     nur in der Produktion, nicht im Spiegel:  0       (echte Obermenge)
 *
 * Banken und Versicherer tragen `currentAssets:null` — Schluessel da, Wert nicht finit.
 * Wer das Werkzeug zur Abschaetzung benutzte, bekam eine 11-fach zu hohe Zahl. Das
 * Werkzeug ist die Messlatte fuer den Abruf-Radius; eine kaputte Messlatte ist
 * gefaehrlicher als ein kaputter Gegenstand, weil sie still falsch misst.
 *
 * GEFIXT durch IMPORT statt Reparatur: ein Nachbau kann nur wieder driften. Dieser
 * Waechter haelt beides fest —
 *   1. das Werkzeug meldet auf einer winzigen Vorlage GENAU die bekannte Zahl,
 *   2. und es stimmt auf JEDEM Vorlagen-Fall mit der Produktionsregel ueberein.
 * Punkt 2 ist die eigentliche Drift-Sperre: Punkt 1 allein wuerde man beim naechsten
 * Semantik-Wechsel einfach hochzaehlen.
 *
 * Die Vorlage unterscheidet BEIDE Drift-Stufen (Gegenprobe unten, ausgefuehrt):
 *     alter Spiegel (Number.isFinite)         5 stale
 *     Produktion VOR  PR #118                 4 stale
 *     Produktion NACH PR #118 (= Soll)        3 stale
 *
 * Usage:  node tests/tag229a-spiegel-produktionsgleich.test.js   (Exit 0/1), netzwerkfrei.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURE = path.join(__dirname, 'fixtures', 'tag229a-spiegel');
const werkzeug = require('../scripts/tag229a-stale-snapshot-verify.js');
const { _existingSnapshotMissingTag211lFields: produktion } = require('../pull-yahoo.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

/** Die Vorlage: Ticker -> erwartetes Urteil der PRODUKTION, mit Begruendung. */
const VORLAGE = {
  GESUND: [false, 'currentAssets-Schluessel mit finitem Wert — Schema aktuell'],
  BANKCANULL: [false,
    'DER DRIFTFALL: Schluessel da, Wert null (Bank/Versicherer). Bug 13 — Schluessel-'
    + 'ANWESENHEIT ist das "Schema ist aktuell"-Signal. Der alte finit-basierte Spiegel '
    + 'meldete genau diese Klasse faelschlich als stale, 1.570 mal.'],
  NOSGADEPR: [false,
    'T181: Bilanz-Schluessel da, SGA/Depreciation ganz abwesend — die Form, die die '
    + 'Inhalts-Wachen aus PR #118 erzeugen. Vor #118 waere das stale gewesen (und beim '
    + 'naechsten Lauf wieder: Bug-13-Schleife).'],
  PRETAG211L: [true, 'kein currentAssets-Schluessel — echt vor Tag 211l, muss voll ziehen'],
  PRICEONLY: [false, 'Price-only-Seed ohne annualRev — Vor-Tor, kein erzwungener Voll-Abruf'],
  NOBALROWS: [true, 'annualBalance leer — kein bal[0], Schema nicht nachweisbar aktuell'],
  NULLROW0: [true,
    'erste Bilanzzeile null: der positionale bal[0]-Zugriff faellt auf falsy. HEUTIGES '
    + 'Verhalten, bewusst festgehalten — das ist die T182-Klasse (149 dauerhafte '
    + 'Schleifen). Ein spaeterer T182-Fix MUSS diesen Waechter anfassen, statt ihn '
    + 'unbemerkt zu ueberholen.'],
};
const SOLL_STALE = Object.values(VORLAGE).filter(([e]) => e).length;   // 3

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

function ladeVorlage(ticker) {
  const fp = path.join(FIXTURE, safeSnapshotFilename(ticker));
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

// --- 0. Die Vorlage existiert wirklich (sonst pruefte alles darunter nichts) ---

test('die Vorlage liegt vollstaendig auf der Platte', () => {
  const daten = fs.readdirSync(FIXTURE).filter(f => f.endsWith('.json')).sort();
  assert.deepEqual(daten, Object.keys(VORLAGE).map(t => safeSnapshotFilename(t)).sort(),
    'Vorlagen-Verzeichnis und VORLAGE-Tabelle muessen deckungsgleich sein — sonst prueft '
    + 'der Zaehl-Test unten eine andere Menge, als die Tabelle beschreibt');
  assert.equal(daten.length, 7, 'sieben Faelle');
});

// --- 1. Die bekannte Zahl -----------------------------------------------------

test(`das Werkzeug meldet auf der Vorlage genau ${SOLL_STALE} stale`, () => {
  const gemeldet = Object.keys(VORLAGE)
    .filter(t => werkzeug.existingSnapshotMissingTag211lFields(t, FIXTURE).stale);
  assert.equal(gemeldet.length, SOLL_STALE,
    `erwartet ${SOLL_STALE}, gemeldet ${gemeldet.length} (${gemeldet.join(', ')}). Weicht die `
    + 'Zahl ab, hat sich die Melder-Semantik geaendert — dann gehoert die Tabelle oben '
    + 'BEGRUENDET angepasst, nicht die Zahl hochgezaehlt.');
  assert.deepEqual(gemeldet.sort(), Object.entries(VORLAGE).filter(([, v]) => v[0]).map(([k]) => k).sort());
});

// --- 2. DIE DRIFT-SPERRE: Werkzeug === Produktion, Fall fuer Fall -------------

test('das Werkzeug stimmt auf JEDEM Vorlagen-Fall mit der Produktionsregel ueberein', () => {
  for (const [ticker, [erwartet, warum]] of Object.entries(VORLAGE)) {
    const vomWerkzeug = werkzeug.existingSnapshotMissingTag211lFields(ticker, FIXTURE).stale;
    const vonDerProduktion = produktion(ladeVorlage(ticker));
    assert.equal(vomWerkzeug, vonDerProduktion,
      `${ticker}: Werkzeug sagt ${vomWerkzeug}, Produktion sagt ${vonDerProduktion} — DAS ist `
      + 'die Drift, die 1.719 statt 149 gemeldet hat. Das Werkzeug muss die Regel '
      + 'IMPORTIEREN, nicht nachbauen.');
    assert.equal(vonDerProduktion, erwartet,
      `${ticker}: die Produktion selbst hat ihr Urteil geaendert (erwartet ${erwartet}). ${warum}`);
  }
});

// --- 3. GEGENPROBE: die Vorlage unterscheidet die Drift-Stufen wirklich -------

test('Gegenprobe (absichtlicher Bruch): der ALTE Spiegel zaehlt auf dieser Vorlage anders', () => {
  // Die abgedriftete Fassung woertlich nachgebaut. Zaehlt sie gleich, waere die Vorlage
  // blind und Test 2 wertlos.
  const alterSpiegel = s => {
    const A = s && s.annual; if (!A) return false;
    if (!(Array.isArray(A.annualRev) && A.annualRev.length > 0)) return false;
    const hasSGA = Array.isArray(A.annualSGA) && A.annualSGA.length > 0;
    const hasDepr = Array.isArray(A.annualDepreciation) && A.annualDepreciation.length > 0;
    const bal = A.annualBalance;
    const hasCA = Array.isArray(bal) && bal[0] && Number.isFinite(bal[0].currentAssets); // DRIFT
    return !(hasSGA || hasDepr) || !hasCA;
  };
  const n = Object.keys(VORLAGE).filter(t => alterSpiegel(ladeVorlage(t))).length;
  assert.equal(n, 5,
    `der alte Spiegel muss auf dieser Vorlage 5 melden (statt ${SOLL_STALE}) — nur dann `
    + 'faengt die Vorlage die 11,54x-Drift wirklich');
  assert.notEqual(n, SOLL_STALE, 'Vorlage waere blind');
  assert.equal(alterSpiegel(ladeVorlage('BANKCANULL')), true,
    'BANKCANULL ist der Fall, an dem sich die Drift zeigt — der alte Spiegel MUSS ihn melden');
  assert.equal(produktion(ladeVorlage('BANKCANULL')), false, 'die Produktion darf ihn NICHT melden');
});

test('Gegenprobe: auch die VOR-#118-Produktion zaehlt anders (T181-Fall gedeckt)', () => {
  const vor118 = s => {
    const A = s && s.annual; if (!A) return false;
    if (!(Array.isArray(A.annualRev) && A.annualRev.length > 0)) return false;
    const hasSGA = Array.isArray(A.annualSGA) && A.annualSGA.length > 0;
    const hasDepr = Array.isArray(A.annualDepreciation) && A.annualDepreciation.length > 0;
    const bal = A.annualBalance;
    const hasCA = Array.isArray(bal) && bal[0] && ('currentAssets' in bal[0]);
    return !(hasSGA || hasDepr) || !hasCA;
  };
  const n = Object.keys(VORLAGE).filter(t => vor118(ladeVorlage(t))).length;
  assert.equal(n, 4,
    `die Fassung vor PR #118 muss 4 melden (statt ${SOLL_STALE}) — sonst deckt die Vorlage `
    + 'den T181-Schritt gar nicht ab');
  assert.equal(vor118(ladeVorlage('NOSGADEPR')), true, 'NOSGADEPR ist der T181-Unterscheidungsfall');
  assert.equal(produktion(ladeVorlage('NOSGADEPR')), false, 'die neue Produktion meldet ihn nicht mehr');
});

// --- 4. Das Werkzeug bleibt einbindbar, ohne den Messlauf zu starten ----------

test('das Werkzeug laesst sich einbinden, ohne den Snapshot-Messlauf zu fahren', () => {
  for (const k of ['existingSnapshotMissingTag211lFields', 'existingSnapshotMissingCurrencyNormalization', 'getExistingSnapshotAge']) {
    assert.equal(typeof werkzeug[k], 'function', k + ' muss exportiert sein');
  }
  // Der Frueh-Ausstieg (require.main !== module) muss halten. Ohne ihn faehrt schon das
  // require den vollen Messlauf ueber den ganzen Snapshot-Bestand — das misst niemand
  // durch Nachdenken, also wird es AUSGEFUEHRT: ein Kindprozess bindet das Werkzeug ein
  // und darf dabei nichts ausgeben.
  const ausgabe = execFileSync(process.execPath,
    ['-e', 'require(process.argv[1])', path.join(__dirname, '..', 'scripts', 'tag229a-stale-snapshot-verify.js')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Gemessen wird die ERSTE Zeile des Messlaufs, nicht Leere: das transitive require von
  // pull-yahoo.js gibt einen FX-Banner aus, der mit dieser Sache nichts zu tun hat. Wer
  // hier auf '' prueft, pinnt fremdes Verhalten und wird beim naechsten Banner rot.
  assert.ok(!/snapshot universe total/.test(ausgabe),
    'das Einbinden hat den Messlauf gestartet (Ausgabe: ' + ausgabe.slice(0, 160) + ') — '
    + 'dann laeuft bei JEDEM Testlauf ein Voll-Scan ueber ~15.000 Snapshots mit');
});

console.log(`\ntag229a-spiegel-produktionsgleich.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
