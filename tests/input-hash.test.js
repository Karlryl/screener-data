'use strict';
/**
 * Waechter zum inputHash (Rat 23.08. Weichen B1/B2, Gerichtsauflage 23.08. Revision 2).
 *
 * Festgenagelt wird eine SACHE, kein Textmuster - und seit Fassung 2 auf zwei Ebenen:
 *
 *   (a) VOLLSTAENDIGKEIT, abgeleitet statt behauptet. Ein Proxy zeichnet auf, welche
 *       Snapshot-Felder das Scoring beim Laufen tatsaechlich anfasst; der Test verlangt, dass
 *       JEDER beobachtete Pfad im Modul einer Schicht zugeordnet ist. Genau diese Pruefung
 *       fehlte in Fassung 1 - deshalb konnte `meta.industry` das Routing bewegen, waehrend
 *       alle Hashes byte-identisch blieben (Fall SOFI, Gericht 23.08.).
 *   (b) TRENNSCHAERFE. Der Hash muss auf jede Register-Reihe reagieren, auf einen echten
 *       Klassenwechsel reagieren - und auf einen blossen Kurstick NICHT.
 *
 * NIE UEBERSPRUNGEN: liegen echte Snapshots, wird gegen sie beobachtet (staerker); sonst gegen
 * einen im Test gebauten Satz. Beides ist eine echte Pruefung - das blockierende Gate laeuft
 * vor dem Yahoo-Pull, wo `snapshots/` leer ist, und ein Test der dort aussteigt meldet gruen,
 * ohne etwas geprueft zu haben. Skip ist nicht Pass.
 *
 * Usage:  node --test tests/input-hash.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FIELD_REGISTRY } = require('../src/scoring/snapshot.js');
const { scoreUniverse } = require('../src/scoring/score.js');
const formeln = require('../src/scoring/formulas/index.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { beobachte, nurBlattpfade } = require('../lib/gelesene-felder.js');
const {
  inputHash, serienFelder, abgedecktePfade, KOHORTE_FELDER, VOLATIL_FELDER, SERIEN_EXTRA,
} = require('../lib/input-hash.js');

const REPO = path.resolve(__dirname, '..');

function serieFuer(format, faktor) {
  if (format === 'value') return [{ value: 100 * faktor }, { value: 90 * faktor }, { value: 80 * faktor }];
  if (format === 'scalar') return [10 * faktor, 9 * faktor, 8 * faktor];
  if (format === 'multikey') return [{ cash: 5 * faktor, totalDebt: 3 * faktor, totalAssets: 20 * faktor }];
  throw new Error(`unbekanntes Speicherformat "${format}" - Register erweitert, Probe nicht?`);
}

/** Vollbesetzter Probe-Snapshot. Register-Felder BEWUSST aus FIELD_REGISTRY, nicht aus
 *  serienFelder() - sonst baut sich die Probe aus derselben Liste, die geprueft wird (L36). */
function bauSnapshot(faktor = 1, extra = {}) {
  const s = {
    meta: {
      ticker: 'PROBE' + faktor, name: 'Probe AG', sector: 'Technology', industry: 'Software - Infrastructure',
      country: 'United States', region: 'US', exchangeName: 'NasdaqGS',
      ipoYear: 2015, firstTradeDate: '2015-06-01T00:00:00.000Z',
      reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', tradingCurrency: 'USD',
      fetchedAt: '2026-08-23T00:00:00.000Z', fullTimeEmployees: 1234,
    },
    marketCap: { value: 5e9, source: 'probe', asOf: '2026-08-23T00:00:00.000Z' },
    metrics: { beta: { value: 1.1 }, forwardPE: { value: 20 }, revenueTTM: { value: 400 } },
    external: {},
    annual: {}, timeseries: { revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30'] },
  };
  for (const f of Object.keys(FIELD_REGISTRY)) {
    const [container, format] = FIELD_REGISTRY[f];
    s[container] = s[container] || {};
    s[container][f] = serieFuer(format, faktor);
  }
  Object.assign(s.meta, extra);
  return s;
}

/** Echtes Universum, wenn vorhanden - sonst ein gebauter Satz. Nie ein Skip. */
function probeUniversum() {
  const dir = path.join(REPO, 'snapshots');
  try {
    const files = fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !isMetadataSnapshot(x));
    if (files.length >= 100) {
      const u = [];
      const schritt = Math.max(1, Math.floor(files.length / 300));
      for (let i = 0; i < files.length && u.length < 300; i += schritt) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(dir, files[i]), 'utf8'));
          if (s && s.meta && s.meta.ticker) u.push(s);
        } catch (_) { /* unlesbar zaehlt nicht */ }
      }
      if (u.length >= 100) return { universum: u, substrat: `echte Snapshots (${u.length})` };
    }
  } catch (_) { /* kein Verzeichnis */ }
  const gebaut = [1, 2, 3].map((f) => bauSnapshot(f));
  gebaut.push(bauSnapshot(4, { sector: 'Financial Services', industry: 'Credit Services' }));
  gebaut.push(bauSnapshot(5, { sector: 'Healthcare', industry: 'Biotechnology', region: 'EU', tradingCurrency: 'EUR' }));
  return { universum: gebaut, substrat: `gebauter Satz (${gebaut.length}) - kein echtes Universum vorhanden` };
}

// --- (a) Vollstaendigkeit: abgeleitet, nicht behauptet ----------------------------------

test('JEDES Feld, das das Scoring beim Laufen liest, ist einer Schicht zugeordnet', () => {
  const { universum, substrat } = probeUniversum();
  console.log(`  (Beobachtungs-Substrat: ${substrat})`);
  const gelesen = nurBlattpfade(beobachte(universum, (u) => scoreUniverse(u, formeln)));
  assert.ok(gelesen.size >= 20, `nur ${gelesen.size} beobachtete Pfade - die Beobachtung greift nicht`);
  // Das Instrument selbst wird geprueft, nicht nur sein Ergebnis: eine Beobachtung, die einen
  // ganzen Container verschweigt, waere leise blind und der Test daneben gruen. Erwartet wird
  // hier eine Eigenschaft des SCORINGS (es liest aus jedem dieser Bloecke), nicht eine des
  // Hash-Moduls - sonst pruefte sich die Abdeckung an sich selbst (L36).
  for (const block of ['meta', 'annual', 'timeseries', 'marketCap']) {
    const treffer = [...gelesen].filter((p) => p.startsWith(block + '.'));
    assert.ok(treffer.length > 0,
      `Die Beobachtung meldet KEIN Feld aus "${block}" - das Scoring liest dort nachweislich. `
      + 'Damit ist das Messinstrument blind, nicht der Code sauber.');
  }
  const abgedeckt = abgedecktePfade().alle;
  const fehlend = [...gelesen].filter((p) => !abgedeckt.has(p)).sort();
  assert.deepEqual(fehlend, [],
    `Das Scoring liest ${fehlend.length} Feld(er), die der inputHash NICHT kennt: ${fehlend.join(', ')}.\n`
    + '       Jedes davon kann den Score bewegen, ohne dass der Hash es zeigt - genau der Defekt, '
    + 'an dem der Fussabdruck-Vertrag am 23.08. gescheitert ist (Fall SOFI/meta.industry).\n'
    + '       Heilung: das Feld in lib/input-hash.js einer Schicht zuordnen (serien / kohorte / volatil) '
    + '- und die Zuordnung begruenden, nicht nur eintragen.');
});

test('die Abdeckung ist nicht durch Aufblaehen erschlichen', () => {
  const a = abgedecktePfade();
  assert.ok(SERIEN_EXTRA.length <= 5, `SERIEN_EXTRA ist auf ${SERIEN_EXTRA.length} gewachsen - Register statt Sonderliste pflegen`);
  assert.ok(a.kohorte.length <= 25, `Kohorte-Liste auf ${a.kohorte.length} gewachsen - wird hier alles hineingekippt?`);
  assert.ok(a.volatil.length <= 25, `Volatil-Liste auf ${a.volatil.length} gewachsen`);
  // Keine Schicht darf ein Feld doppelt fuehren - sonst ist die Trennung nur behauptet.
  const alle = [...a.serien, ...a.kohorte, ...a.volatil];
  assert.equal(new Set(alle).size, alle.length, 'ein Pfad steht in mehr als einer Schicht');
});

// --- (b) Trennschaerfe -----------------------------------------------------------------

test('der Pruefstein aus dem Gerichtsverfahren: eine reine industry-Aenderung bewegt den Hash', () => {
  const a = inputHash(bauSnapshot());
  const b = inputHash(bauSnapshot(1, { industry: 'Credit Services' }));
  assert.notEqual(a.kohorteHash, b.kohorteHash,
    'meta.industry bewegt den Kohorte-Hash nicht. Genau daran ist Fassung 1 gescheitert: '
    + 'router.js entscheidet daran zwischen exclude/ und route/financials.');
  assert.notEqual(a.stabil, b.stabil, 'industry-Aenderung erreicht `stabil` nicht');
  assert.equal(a.serienHash, b.serienHash, 'industry hat den SERIEN-Hash bewegt - die Trennung leckt');
});

test('ein blosser Kurstick bewegt weder Kohorte noch stabil - nur ein echter Klassenwechsel', () => {
  const basis = bauSnapshot();
  const a = inputHash(basis);
  const tick = bauSnapshot(); tick.marketCap.value = basis.marketCap.value * 1.02;
  assert.equal(inputHash(tick).kohorteHash, a.kohorteHash,
    'Ein 2-%-Kurstick bewegt den Kohorte-Hash. Dann bewegt er sich fuer ~87 % der Zeilen taeglich '
    + '(gemessen Runde 1: 7.226 von 8.313) und die Aussage "Kohorte unveraendert" ist wertlos.');
  const sprung = bauSnapshot(); sprung.marketCap.value = 1e6;
  assert.notEqual(inputHash(sprung).kohorteHash, a.kohorteHash, 'ein echter Groessenklassen-Wechsel bleibt unbemerkt');
});

test('volatile Felder bewegen `gesamt`, aber NICHT `stabil`', () => {
  const a = inputHash(bauSnapshot());
  const v = bauSnapshot(); v.metrics.beta = { value: 9.99 };
  const b = inputHash(v);
  assert.notEqual(b.volatilHash, a.volatilHash, 'ein volatiles Feld erreicht den volatil-Hash nicht');
  assert.notEqual(b.gesamt, a.gesamt, '`gesamt` schliesst die volatile Schicht nicht ein');
  assert.equal(b.stabil, a.stabil,
    '`stabil` hat sich durch ein kurs-getriebenes Feld bewegt - dann traegt es die Aussage '
    + '"fundamentaler Eingang unveraendert" nicht mehr.');
});

// --- Register-Ebene (unveraendert aus Fassung 1, weiterhin gueltig) ---------------------

test('die abgeleitete Feldliste IST das Register - keine stille Teilmenge', () => {
  assert.deepEqual(serienFelder(), Object.keys(FIELD_REGISTRY).sort(),
    'serienFelder() weicht vom FIELD_REGISTRY ab. Jedes ausgelassene Feld wird ab sofort als '
    + 'Lineal-Drift verbucht statt als Daten-Drift - die Zerlegung luegt dann leise.');
});

test('JEDES Register-Feld bewegt den Serien-Hash', () => {
  const basis = inputHash(bauSnapshot()).serienHash;
  const taub = [];
  for (const f of Object.keys(FIELD_REGISTRY)) {
    const s = bauSnapshot();
    const [container, format] = FIELD_REGISTRY[f];
    s[container][f] = serieFuer(format, 2);
    if (inputHash(s).serienHash === basis) taub.push(f);
  }
  assert.deepEqual(taub, [], `Der inputHash ist blind fuer: ${taub.join(', ')}`);
});

test('ein fehlendes Feld bewegt den Hash genauso wie ein geaendertes', () => {
  const basis = inputHash(bauSnapshot()).serienHash;
  const taub = [];
  for (const f of Object.keys(FIELD_REGISTRY)) {
    const s = bauSnapshot();
    delete s[FIELD_REGISTRY[f][0]][f];
    if (inputHash(s).serienHash === basis) taub.push(f);
  }
  assert.deepEqual(taub, [], `Wegfall unbemerkt bei: ${taub.join(', ')}`);
});

test('nicht gelesene Beifelder bewegen den Hash NICHT', () => {
  const basis = inputHash(bauSnapshot()).stabil;
  const s = bauSnapshot();
  s.meta.fetchedAt = '2099-12-31T00:00:00.000Z';
  s.meta.fullTimeEmployees = 999999;
  s.marketCap.asOf = '2099-12-31T00:00:00.000Z';
  assert.equal(inputHash(s).stabil, basis,
    'Ein Feld, das das Scoring gar nicht liest, bewegt `stabil`. Dann waere fast jede Zeile '
    + 'jeden Tag "Daten-Drift" und die Zerlegung nutzlos.');
});

test('der Hash ist deterministisch und unabhaengig von der Schluessel-Reihenfolge', () => {
  const a = bauSnapshot();
  const b = bauSnapshot();
  for (const c of ['annual', 'timeseries']) {
    const umgedreht = {};
    for (const k of Object.keys(b[c]).reverse()) umgedreht[k] = b[c][k];
    b[c] = umgedreht;
  }
  assert.equal(inputHash(b).serienHash, inputHash(a).serienHash, 'Der Hash haengt an der Schluessel-Reihenfolge');
  assert.equal(inputHash(a).gesamt, inputHash(bauSnapshot()).gesamt, 'nicht deterministisch');
});

test('secAnnual geht ein, ohne dass seine Schluessel von Hand gelistet werden', () => {
  const ohne = inputHash(bauSnapshot()).serienHash;
  const s = bauSnapshot();
  s.secAnnual = { annualRev: [{ value: 1 }], annualOpInc: [{ value: 2 }] };
  const mit = inputHash(s).serienHash;
  assert.notEqual(mit, ohne, 'secAnnual geht nicht in den Hash ein');
  const s2 = bauSnapshot();
  s2.secAnnual = { annualRev: [{ value: 1 }], annualOpInc: [{ value: 2 }], annualFCF: [{ value: 3 }] };
  assert.notEqual(inputHash(s2).serienHash, mit, 'ein ZUSAETZLICHER secAnnual-Schluessel bleibt unbemerkt');
});
