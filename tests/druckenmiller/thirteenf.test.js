'use strict';
/** tests/druckenmiller/thirteenf.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: die drei Fallen, die Lane B und ihr Red Team teuer gelernt haben, sind
 * gepruefte Wächter — an ECHTEN Einreichungen, nicht an erfundenen:
 *   D2  die Einheit wechselt mitten in der Reihe (2022-12-31 Dollar, 2026-06-30 Tausende)
 *   D3  passt keine oder passen beide Lesungen, geht das Filing in QUARANTAENE
 *   D4  eine Optionszeile ohne `putCall` erkennt man an der CUSIP-Emissionsnummer (GLD 907)
 *   D6  ein Namens-Treffer ohne Identitaet wird abgelehnt (Barrick -> ABX/Abacus)
 * Und D8: der dreiwertige Join sagt NIE "nicht gehalten" — er sagt "nicht unter den
 * zugeordneten Positionen", weil die Abdeckung kleiner als eins ist.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../../lib/druckenmiller/thirteenf.js');

const FIX = path.join(__dirname, 'fixtures', '13f');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}
const xmlVon = (p) => fs.readFileSync(path.join(FIX, p), 'utf8');

test('D1 die Informationstabelle wird gelesen, und Unsinn wirft', () => {
  const rows = T.parseInfoTable(xmlVon('form13f_20221231.xml'));
  assert.equal(rows.length, 58);
  const erste = rows[0];
  assert.equal(erste.issuer, 'Abcellera Biologics Inc');
  assert.equal(erste.cusip, '00288U106');
  assert.equal(erste.valueRaw, 6683268);
  assert.equal(erste.shares, 659750);
  assert.equal(erste.shareType, 'SH');
  assert.throws(() => T.parseInfoTable('<html>nichts</html>'), /keine Informationstabelle/);
  assert.throws(() => T.parseInfoTable('<infoTable'), /keine Informationstabelle|keine Zeile/);
});

test('D2 die Einheit wird je Filing erkannt — Dollar 2022-12-31, Tausende 2026-06-30', () => {
  const d = T.detectUnits(T.parseInfoTable(xmlVon('form13f_20221231.xml')));
  assert.equal(d.units, 'dollars', 'gemessen: Median value/shares = 40,17 (Dollar-Lesung plausibel)');
  assert.equal(d.quarantine, false);
  assert.ok(d.medianImplied > 10 && d.medianImplied < 100, 'Median: ' + d.medianImplied);
  const t = T.detectUnits(T.parseInfoTable(xmlVon('form13f_20260630.xml')));
  assert.equal(t.units, 'thousands', 'Dollar-Lesung waere 0,09 je Anteil — unmoeglich');
  assert.equal(t.quarantine, false);
  assert.ok(t.medianImplied > 10 && t.medianImplied < 1000, 'Median: ' + t.medianImplied);
});

test('D3 QUARANTAENE, wenn keine oder beide Lesungen plausibel sind', () => {
  // Keine: 0,0001 je Anteil in Dollar, 0,1 in Tausenden — beides unter dem Band.
  const keine = T.detectUnits([{ valueRaw: 1, shares: 10000, cusip: '11111110' }]);
  assert.equal(keine.quarantine, true);
  assert.equal(keine.reason, 'no-plausible-unit');
  assert.equal(keine.units, null, 'eine unerkannte Einheit wird NICHT geraten');
  // Beide: 2 je Anteil in Dollar, 2.000 in Tausenden — beide im Band [1, 5000].
  const beide = T.detectUnits([{ valueRaw: 2, shares: 1, cusip: '22222220' }]);
  assert.equal(beide.quarantine, true);
  assert.equal(beide.reason, 'ambiguous-unit');
  // Und ohne brauchbare Zeile gibt es keine Einheit, sondern einen Befund.
  const leer = T.detectUnits([{ valueRaw: null, shares: null, cusip: 'x' }]);
  assert.equal(leer.reason, 'no-usable-row');
});

test('D4 die Preisprobe: ueber 10 % Fehlerquote geht das Filing in Quarantaene', () => {
  // Die Kurskarte ist nach TICKER gebaut, wie das Skript sie liefert — genau daran scheiterte
  // die Probe vorher (Review-Fund: die Roh-Zeile kennt nur ihre CUSIP).
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ valueRaw: 100, shares: 1, cusip: 'C' + i, ticker: 'T' + i, putCall: null });
  }
  const kurse = new Map();
  for (let i = 0; i < 20; i++) kurse.set('T' + i, i < 18 ? 100 : 5);   // 2 von 20 = 10 %
  const knapp = T.detectUnits(rows, kurse);
  assert.equal(knapp.mode, 'price-checked');
  assert.ok(Math.abs(knapp.failShare - 0.1) < 1e-9, 'Fehlerquote: ' + knapp.failShare);
  assert.equal(knapp.quarantine, false, 'genau 10 % ist noch nicht "ueber 10 %"');
  kurse.set('T17', 5);                                                  // 3 von 20 = 15 %
  const drueber = T.detectUnits(rows, kurse);
  assert.equal(drueber.quarantine, true);
  assert.equal(drueber.reason, 'implied-price-fail-share');
  assert.equal(T.QUARANTINE_FAIL_SHARE, 0.1);
  // Und eine Kurskarte OHNE einen einzigen Treffer ist keine Preisprobe, sondern ein Ausfall —
  // sie darf nicht als bewusste Bandentscheidung durchgehen.
  const ohneTreffer = T.detectUnits(rows, new Map([['XYZ', 100]]));
  assert.equal(ohneTreffer.mode, 'band-only-no-price-match');
  assert.equal(ohneTreffer.nChecked, 0);
  assert.equal(ohneTreffer.failShare, null);
});

test('D5 eine Optionszeile ohne putCall-Tag erkennt man an der CUSIP (Lane-B-Fall GLD 907)', () => {
  assert.deepEqual(T.isOption({ cusip: '78463V907', putCall: null }),
    { option: true, reason: 'cusip-issue-number' });
  assert.deepEqual(T.isOption({ cusip: '78463V957', putCall: null }),
    { option: true, reason: 'cusip-issue-number' });
  assert.deepEqual(T.isOption({ cusip: '00288U106', putCall: null }), { option: false, reason: null });
  assert.equal(T.isOption({ cusip: '00288U106', putCall: 'Call' }).reason, 'putCall-tag');
  // Im echten Filing 2026-06-30 traegt der Bestand neun getaggte Optionszeilen.
  const rows = T.parseInfoTable(xmlVon('form13f_20260630.xml'));
  assert.equal(rows.filter((r) => T.isOption(r).option).length, 9);
});

test('D6 IDENTITAETS-WACHE: ein Namens-Treffer ohne Identitaet wird abgelehnt (Barrick/Abacus)', () => {
  const karte = new Map([['ABX', 'Abacus Life Inc'], ['AAPL', 'Apple Inc.']]);
  const index = T.buildNameIndex(karte);
  const treffer = T.mapIssuer('Abacus Life Inc', index);
  assert.equal(treffer.ticker, 'ABX', 'der echte Abacus-Treffer bleibt');
  assert.equal(T.identityOk('Abacus Life Inc', 'Abacus Life Inc'), true);
  // Der Red-Team-Fall: Barrick Gold darf NICHT als ABX durchgehen.
  assert.equal(T.identityOk('Barrick Gold Corp', 'Abacus Life Inc'), false);
  assert.equal(T.mapIssuer('Barrick Gold Corp', index).ticker, null);
  // Mehrdeutige Treffer werden verworfen, nicht gewuerfelt.
  const doppelt = T.buildNameIndex(new Map([['AAA', 'Delta Corp'], ['BBB', 'Delta Inc']]));
  assert.equal(T.mapIssuer('Delta', doppelt).ticker, null);
  assert.match(T.mapIssuer('Delta', doppelt).reason, /ambiguous/);
});

test('D7 ein Quartal in Vertragsform, an der echten Einreichung gerechnet', () => {
  const karte = new Map([['ABCL', 'AbCellera Biologics Inc'], ['AAPL', 'Apple Inc.']]);
  const q = T.buildQuarter({
    period: '2022-12-31', xml: xmlVon('form13f_20221231.xml'),
    nameIndex: T.buildNameIndex(karte), now: new Date('2026-09-19T00:00:00Z'),
  });
  assert.equal(q.units, 'dollars');
  assert.equal(q.positions, 57, '58 Zeilen minus die eine Optionszeile');
  assert.ok(q.totalValueUSD > 1.9e9 && q.totalValueUSD < 2.1e9, 'Gesamtwert: ' + q.totalValueUSD);
  assert.ok(q.top10Share > 0.6 && q.top10Share < 0.8, 'Top-10: ' + q.top10Share);
  const abcl = q.rows.find((r) => r.cusip === '00288U106');
  assert.equal(abcl.ticker, 'ABCL', 'der Namens-Treffer mit Identitaet wird uebernommen');
  assert.ok(Math.abs(abcl.valueUSD / abcl.shares - 10.13) < 0.01, 'impliedPrice: der echte Kurs Ende 2022');
  assert.equal(abcl.impliedPriceOk, true);
  assert.equal(q.rows.filter((r) => r.putCall).length, 1, 'die Optionszeile bleibt getrennt');
  assert.equal(q.new, null, 'ohne Vorquartal gibt es keine Neu-Liste — nicht eine leere');
  const q2 = T.buildQuarter({
    period: '2026-06-30', xml: xmlVon('form13f_20260630.xml'), nameIndex: null,
    previousCusips: new Set(['00288U106']), now: new Date('2026-09-19T00:00:00Z'),
  });
  assert.ok(Array.isArray(q2.new) && q2.new.length > 50, 'mit Vorquartal gibt es Neu-Eintritte');
  assert.deepEqual(q2.exited, ['00288U106']);
  assert.equal(q2.rows.every((r) => r.ticker === null), true, 'ohne Namenskarte bleibt jede Zeile ohne Ticker');
  assert.equal(q2.coverage, 0, 'und die Abdeckung ist 0 — eine Aussage, kein Fehler');
});

test('D8 der dreiwertige Join sagt nie "nicht gehalten"', () => {
  const gehalten = new Set(['AAPL', 'NVDA']);
  assert.equal(T.triStateFor('AAPL', gehalten, 0.6), 'HELD');
  assert.equal(T.triStateFor('MSFT', gehalten, 0.6), 'NOT_IN_MAPPED');
  assert.equal(T.triStateFor('MSFT', gehalten, 0), 'UNMAPPED', 'ohne Abdeckung gibt es keine Aussage');
  assert.equal(T.triStateFor('MSFT', new Set(), 0.6), 'UNMAPPED');
  assert.equal(T.triStateFor(null, gehalten, 0.6), 'NOT_IN_MAPPED');
  assert.deepEqual(T.TRI_STATE, ['HELD', 'NOT_IN_MAPPED', 'UNMAPPED']);
});

test('D9 die Abdeckung der LOKALEN Namenskarte wird gemessen, nicht behauptet', () => {
  const zeilen = fs.readFileSync(path.join(FIX, 'issuers-697.csv'), 'utf8').split('\n')
    .filter((z) => z.trim()).slice(1);
  const issuers = zeilen.map((z) => {
    const i = z.indexOf(',');
    return { cusip: z.slice(0, i), issuer: z.slice(i + 1) };
  });
  assert.equal(issuers.length, 697, 'die Emittentenliste des 13F-Bestands (nur cusip + issuer)');
  // Eine kleine Karte trifft wenig — und genau das ist die Aussage des Tests: die Messung
  // haengt an der Karte, nicht an einer Behauptung.
  const klein = T.matcherCoverage(issuers, T.buildNameIndex(new Map([['AAPL', 'Apple Inc.']])));
  assert.equal(klein.n, 697);
  assert.ok(klein.matched <= 2, 'mit einem Namen in der Karte gibt es hoechstens einen Treffer');
  assert.ok(klein.share < 0.01);
  // Mit den echten 13F-Namen als Karte muss die Abdeckung dagegen hoch sein (Gegenprobe,
  // dass der Matcher ueberhaupt trifft).
  const selbst = new Map(issuers.slice(0, 200).map((i, n) => ['T' + n, i.issuer]));
  const gross = T.matcherCoverage(issuers.slice(0, 200), T.buildNameIndex(selbst));
  assert.ok(gross.share > 0.9, 'der Matcher trifft seine eigenen Namen: ' + gross.share);
});

test('D10 Normalform: Rechtsformen und Interpunktion fallen, der Kern bleibt', () => {
  assert.equal(T.normName('Apple Inc.'), 'apple');
  assert.equal(T.normName('The Coca-Cola Company'), 'coca cola');
  assert.equal(T.normName('Alphabet Inc. Class C'), 'alphabet c');
  assert.equal(T.normName('AT&T Inc'), 'at and t');
  assert.equal(T.normName(''), '');
  assert.equal(T.normName(null), '');
});

test('D11 die Schwellen des Betrachters stehen im Vergleichsmassstab (Muster R11)', () => {
  const soll = require('./fixtures/spec-constants.json').thirteenF;
  assert.equal(T.QUARTERS_PUBLISHED, soll.quartersPublished);
  assert.deepEqual([T.IMPLIED_PRICE_MIN, T.IMPLIED_PRICE_MAX], soll.impliedPriceBandUSD);
  assert.equal(T.QUARANTINE_FAIL_SHARE, soll.quarantineFailShare);
  assert.deepEqual([T.PRICE_RATIO_MIN, T.PRICE_RATIO_MAX], soll.priceRatioBand);
  assert.deepEqual(T.OPTION_ISSUE_NUMBERS, soll.optionIssueNumbers);
  assert.deepEqual(T.TRI_STATE, soll.triState);
  // Und der Satz, der diese Sektion von einer Vorregistrierung unterscheidet, steht da.
  assert.match(soll._origin, /DATENQUALITAETS-Schwellen|keine Ergebnis-Parameter/);
  assert.equal(soll.measuredCoverage2026_09_19.matched, 308, 'die gemessene Abdeckung ist festgehalten');
});

test('D12 eine QUARANTAENE nullt die Aussagen, nicht nur ein Flag (Review-Fund)', () => {
  // silent-failure-hunter: bei implied-price-fail-share war die Einheit gewaehlt, also wurden
  // Gesamtwert, Positionen, Top-10 und Abdeckung normal gerechnet und VEROEFFENTLICHT - mit
  // einem Flag daneben, das niemand lesen musste.
  const zeilen = [];
  for (let i = 0; i < 20; i++) {
    zeilen.push('<infoTable><nameOfIssuer>Firma ' + i + '</nameOfIssuer><cusip>0000'
      + (10 + i) + '101</cusip><value>100</value><shrsOrPrnAmt><sshPrnamt>1</sshPrnamt>'
      + '<sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>');
  }
  const xml = '<informationTable>' + zeilen.join('\n') + '</informationTable>';
  const karte = new Map();
  for (let i = 0; i < 20; i++) karte.set('T' + i, 'Firma ' + i);
  const kurse = new Map();
  for (let i = 0; i < 20; i++) kurse.set('T' + i, i < 10 ? 100 : 5);   // 50 % scheitern
  const q = T.buildQuarter({ period: '2026-06-30', xml, nameIndex: T.buildNameIndex(karte), closes: kurse });
  assert.equal(q.quarantined, true, 'ueber 10 % Fehlerquote muss die Quarantaene greifen');
  assert.equal(q.quarantineReason, 'implied-price-fail-share');
  for (const feld of ['totalValueUSD', 'positions', 'top10Share', 'coverage']) {
    assert.equal(q[feld], null, feld + ' darf aus einer Quarantaene nicht veroeffentlicht werden');
  }
  assert.equal(q.rows.length, 20, 'die ZEILEN bleiben zum Nachsehen da - nur die Aussagen fallen');
  assert.equal(q.new, null);
  assert.equal(q.exited, null);
});

test('D13 der Praefix-Treffer ist gebunden: Rauschen und Trunkierung ja, ein neues Wort nein', () => {
  // js-Reviewer, reproduziert: "Apple Hospitality REIT Inc" lief als AAPL durch, und identityOk
  // bestaetigte es mit derselben Logik. Gemessen an den echten 697 Emittenten kostet die
  // Verschaerfung 14 Treffer (322 -> 308) und nimmt die falschen mit.
  const nurApple = T.buildNameIndex(new Map([['AAPL', 'Apple Inc.']]));
  assert.equal(T.mapIssuer('Apple Hospitality REIT Inc', nurApple).ticker, null);
  assert.equal(T.identityOk('Apple Hospitality REIT Inc', 'Apple Inc.'), false);
  const nurCabot = T.buildNameIndex(new Map([['CBT', 'Cabot Corporation']]));
  assert.equal(T.mapIssuer('Cabot Oil & Gas Corp', nurCabot).ticker, null, 'zwei verschiedene Firmen');
  // Was weiter gelten MUSS: die SEC-Feldform kuerzt ab, und Abkuerzungen sind kein Unterschied.
  const adobe = T.buildNameIndex(new Map([['ADBE', 'Adobe Inc.']]));
  assert.equal(T.mapIssuer('Adobe Sys Inc', adobe).ticker, 'ADBE');
  const booz = T.buildNameIndex(new Map([['BAH', 'Booz Allen Hamilton Holding Corporation']]));
  assert.equal(T.mapIssuer('Booz Allen Hamilton Hldg Cor', booz).ticker, 'BAH', 'trunkiert bei 28 Zeichen');
  assert.equal(T.praefixErlaubt('General Dynamics Corp', 'General Electric Co'), false,
    'ein gemeinsames erstes Wort ist keine Identitaet');
  assert.equal(T.TRUNKIERUNG_AB, 28);
});

test('D14 die Namenskarte nimmt Windows-reservierte Ticker mit und nur die Metadaten nicht', () => {
  // MERGE-DESK-FUND (Lane A): `datei.startsWith('_')` war die Blanket-Form, die
  // lib/snapshot-fs.js ersetzt. Sie haette echte Snapshots wie _CON.json (ein Ticker, den
  // Windows nicht als Dateinamen erlaubt - safeSnapshotFilename baut ihn mit Unterstrich)
  // still aus der Karte geworfen und die 13F-Abdeckung nach unten verfaelscht.
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-snap-'));
  const schreibe = (datei, ticker, name) => fs.writeFileSync(path.join(dir, datei),
    JSON.stringify({ meta: { ticker, name, country: 'United States' } }) + '\n');
  schreibe('AAPL.json', 'AAPL', 'Apple Inc.');
  schreibe('_CON.json', 'CON', 'Continental Resources Inc');   // echter Ticker, reservierter Name
  schreibe('_manifest.json', 'X', 'Metadaten');                 // Metadaten, muss raus
  fs.writeFileSync(path.join(dir, '_last_good_disk.json'), '{}\n');
  const S = require(path.join(__dirname, '..', '..', 'scripts', 'druckenmiller-13f.js'));
  const karte = S.ladeNamenskarte(dir, null);
  assert.equal(karte.get('AAPL'), 'Apple Inc.');
  assert.equal(karte.get('CON'), 'Continental Resources Inc',
    'ein Windows-reservierter Ticker gehoert in die Karte - sonst fehlt er still in der Abdeckung');
  assert.equal(karte.has('X'), false, 'die Metadaten-Datei bleibt draussen');
  assert.equal(karte.size, 2);
  // Und der geteilte Helfer ist der Maßstab, nicht eine eigene Regel.
  const { isMetadataSnapshot } = require(path.join(__dirname, '..', '..', 'lib', 'snapshot-fs.js'));
  assert.equal(isMetadataSnapshot('_CON.json'), false);
  assert.equal(isMetadataSnapshot('_manifest.json'), true);
  assert.equal(isMetadataSnapshot('_last_good_disk.json'), true);
  // BRUCHPROBE am Quelltext: die Blanket-Form darf in diesem Skript nicht zurueckkehren.
  const quelle = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'druckenmiller-13f.js'), 'utf8');
  const blanket = quelle.split('\n').filter((z) => /startsWith\('_'\)/.test(z) && !z.trim().startsWith('//'));
  assert.deepEqual(blanket, [], 'die Blanket-Form steht wieder im Code: ' + blanket.join(' | '));
});

console.log('\nthirteenf.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
