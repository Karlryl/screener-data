'use strict';
/** tests/druckenmiller/registration.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG (BUILD-SPEC v1 [REV6-1] ONE freeze scheme, fuer Datei A praezisiert
 * durch [REV7-3]): die Registrierungs-Datei A ist keine Behauptung, sondern eine
 * gehashte Groesse, deren Werte NACHWEISLICH die des Rats-Entscheids D3/D4 sind.
 *
 * WARUM DER TEST FUER DATEI A ANDERS AUSSIEHT ALS FUER B/C: die Saat von Chunk 0 (87
 * Zeilen, Rat D2 "jeder Tag verfaellt") ist aelter als dieser Hash. Ein
 * "Hash-Commit vor der ersten Zeile"-Test waere fuer sie strukturell nicht erfuellbar.
 * [REV7-3] ersetzt ihn deshalb durch zwei Zusicherungen, die MEHR beweisen:
 *   (a) Datei A ist byte-gleich mit den D3-Konstanten (Vergleichsmassstab
 *       fixtures/spec-constants.json) — die Saat lief also unter genau diesen Werten,
 *   (b) der laufende Code rechnet noch immer mit denselben Werten — eine spaetere
 *       Verstellung faellt hier auf, nicht erst in den Zahlen.
 * Dazu Residual 4: eine Aenderung an Datei A OHNE Changelog-Zeile ist rot.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const FILE_A = path.join(REPO, 'protocol', 'druckenmiller_loggers_registered_20260914.json');
const SIDECAR = FILE_A + '.sha256';
const SPEC_CONSTANTS = path.join(__dirname, 'fixtures', 'spec-constants.json');
const CHANGELOG = path.join(__dirname, 'fixtures', 'registration.CHANGELOG.md');
const LEDGER = path.join(REPO, 'druckenmiller-history', 'internals-ledger.jsonl');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

const lies = (p) => fs.readFileSync(p, 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
/** Kanonische Form: Schluessel rekursiv sortiert. Byte-Gleichheit OHNE Reihenfolge-Rauschen. */
function kanonisch(v) {
  if (Array.isArray(v)) return '[' + v.map(kanonisch).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + kanonisch(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const fileAText = lies(FILE_A);
const fileA = JSON.parse(fileAText);
const spec = JSON.parse(lies(SPEC_CONSTANTS));

test('R1 der Hash stimmt: Datei A, ihr .sha256-Sidecar und der Changelog nennen dieselbe Zahl', () => {
  const ist = sha256(fileAText);
  const imSidecar = lies(SIDECAR).trim().split(/\s+/)[0];
  assert.equal(imSidecar, ist,
    'der Sidecar nennt ' + imSidecar.slice(0, 12) + '…, die Datei ist ' + ist.slice(0, 12) + '… — '
    + 'entweder wurde die Datei nach dem Hashen angefasst oder der Sidecar ist von einem anderen Stand');
  // Der Sidecar nennt den Dateinamen mit, sonst passt er auf jede beliebige Datei.
  assert.match(lies(SIDECAR), /druckenmiller_loggers_registered_20260914\.json/);
});

test('R2 RESIDUAL 4: eine Aenderung an Datei A ohne Changelog-Zeile ist rot', () => {
  const changelog = lies(CHANGELOG);
  const zeilen = changelog.split('\n').filter((l) => l.includes('druckenmiller_loggers_registered_'));
  assert.ok(zeilen.length >= 1, 'kein einziger Changelog-Eintrag fuer Datei A');
  const letzte = zeilen[zeilen.length - 1];
  const hashImLog = (letzte.match(/\b[0-9a-f]{64}\b/) || [])[0];
  assert.equal(hashImLog, sha256(fileAText),
    'der letzte Changelog-Eintrag nennt ' + String(hashImLog).slice(0, 12) + '…, die Datei hat aber '
    + sha256(fileAText).slice(0, 12) + '… — Datei A wurde geaendert, ohne dass eine Zeile in '
    + 'registration.CHANGELOG.md sagt, warum. Genau das ist die stille Erosion, die [REV3-5] verbietet.');
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(letzte) && letzte.length > 120,
    'die Changelog-Zeile traegt kein Datum oder keinen Grund — ein Hash allein erklaert nichts');
});

test('R3 KERN [REV7-3]: Datei A ist byte-gleich mit den D3-Konstanten', () => {
  for (const sektion of ['councilD3', 'courtGates', 'rIntLoggedOnly', 'overrideNoteD1']) {
    assert.ok(spec[sektion], 'spec-constants.json hat keine Sektion ' + sektion);
    assert.ok(fileA[sektion], 'Datei A hat keine Sektion ' + sektion);
    assert.equal(kanonisch(fileA[sektion]), kanonisch(spec[sektion]),
      'Sektion ' + sektion + ' weicht ab — Datei A und der Vergleichsmassstab sind auseinandergelaufen');
    // Und die Herkunft steht DRAN, nicht daneben (Auflage aus [REV8-5]).
    assert.ok(spec[sektion]._origin && spec[sektion]._date,
      'Sektion ' + sektion + ' nennt ihre Herkunft oder ihr Datum nicht');
  }
  assert.equal(spec._specHash, 'af483fae6a1676476894fab05c1863a6a757e439c60ad8d6ccfd9bf5326a961a',
    'der Vergleichsmassstab zeigt auf eine andere BUILD-SPEC als die eingefrorene');
});

test('R4 BRUCHPROBE: derselbe Vergleich faengt eine verstellte Konstante', () => {
  const verstellt = JSON.parse(fileAText);
  verstellt.councilD3.l3Band = 0.025;
  assert.notEqual(kanonisch(verstellt.councilD3), kanonisch(spec.councilD3),
    'ein von 3 % auf 2,5 % verstelltes L3-Band laeuft durch — der Vergleich ist Dekoration');
  const tief = JSON.parse(fileAText);
  tief.councilD3.universe.minBars = 200;
  assert.notEqual(kanonisch(tief.councilD3), kanonisch(spec.councilD3),
    'eine Aenderung in der VERSCHACHTELUNG laeuft durch — der Vergleich ist nicht tief');
  const umsortiert = JSON.parse(kanonisch(spec.councilD3));
  assert.equal(kanonisch(umsortiert), kanonisch(spec.councilD3),
    'reine Schluessel-Reihenfolge darf NICHT rot machen, sonst wird der Test weggeklickt');
});

test('R5 der laufende Code rechnet mit genau diesen Werten (nicht nur die Datei sagt es)', () => {
  const internals = require('../../lib/druckenmiller/internals.js');
  const U = require('../../lib/druckenmiller/universe.js');
  const d3 = fileA.councilD3;
  assert.equal(internals.BAND, d3.l3Band, 'L3-Band im Code weicht von der Registrierung ab');
  assert.deepEqual(internals.BAND_SENSITIV, d3.l3BandSensitivities);
  assert.equal(internals.HORIZONT_63, d3.axisWindows.returnHorizon);
  assert.equal(internals.SMA_LANG, d3.axisWindows.smaLong);
  assert.equal(internals.SMA_KURZ, d3.axisWindows.smaShort);
  assert.equal(internals.FENSTER_252, d3.axisWindows.highLowWindow);
  assert.equal(internals.L4B_MIN_BASKET, d3.l4bMinBasketN, 'der L4b-Mindestkorb im Code weicht ab');
  // Und die registrierte Quantil-Ausschlussliste ist im Code auch WIRKSAM, nicht nur notiert.
  const ledger = require('../../lib/druckenmiller/ledger.js');
  for (const flag of fileA.rIntLoggedOnly.quantileWindowExcludes) {
    const zeile = { date: '2026-01-02' }; zeile[flag] = true;
    assert.equal(ledger.quantileInput([zeile]).length, 0,
      'registriert ist der Ausschluss von ' + flag + ', erzwungen wird er nicht');
  }
  assert.equal(internals.FRESH_MIN, fileA.courtGates.freshnessMinShare, 'Frische-Tor im Code weicht ab');
  // REVIEW-FUND: churnMaxShare war die EINZIGE registrierte Zahl ohne Code-Waechter — im
  // Schreiber stand `> 0.05` als nackter Literal mitten in einem Ausdruck, und R7 prueft nur,
  // dass das WORT in Datei A vorkommt. Jede Schwelle zwischen 0 und 0,2 waere gruen geblieben.
  // Der Schreiber liest die Zahl jetzt aus der Registrierung; hier wird das gemessen, nicht
  // geglaubt: dieselbe Menge, einmal knapp unter und einmal knapp ueber der Schwelle.
  const W = require('../../scripts/write-druckenmiller-export.js');
  const schwelle = fileA.courtGates.churnMaxShare;
  assert.equal(schwelle, 0.05, 'die registrierte Churn-Schwelle ist nicht mehr 5 %');
  assert.throws(() => W.churnSerie('egal', [], 0, () => {}), /churnMaxShare/,
    'ohne gueltige Schwelle rechnet der Schreiber trotzdem ein Churn-Tor');
  assert.throws(() => W.churnSerie('egal', [], undefined, () => {}), /churnMaxShare/);
  assert.equal(internals.MIN_LIVE_TAGE_FUER_ZUSTAND, fileA.rIntLoggedOnly.minLoggedLiveSessions);
  assert.equal(U.MIN_BARS, d3.universe.minBars);
  assert.deepEqual(U.CYCLICAL_SECTORS, d3.l4.cyclicalSectors);
  assert.deepEqual(U.DEFENSIVE_SECTORS, d3.l4.defensiveSectors);
  assert.deepEqual(U.NAMED_BASKET_INDUSTRIES, d3.l4bNamedIndustries);
  assert.deepEqual(U.SUSPECT_FLAGS, d3.universe.suspectFlags);
  // Der Eimer ist SICHTBAR — Rat D3 verlangt ihn ausdruecklich, D4 nennt kein Ersatz-Mapping.
  assert.equal(U.sectorClass('Technology'), 'unassigned');
  assert.equal(U.sectorClass(null), 'unassigned');
});

// [REV5-6]/[REV7-3]: only explicit backfills are excluded. A present but invalid
// stamp must never fall through to the historical provenance exception.
// T329 (Rat 2026-09-21, ratifiziert): der Stempel ist der TATSAECHLICH VERWENDETE Digest.
// Die alte Regel verlangte den Digest, der am Zeilendatum in Kraft war — das faellt bei
// einem GitHub-Re-Run falsch rot aus (alter Commit, neues generatedAt) und schreibt der
// Zeile einen Stand vor, unter dem sie nie gerechnet wurde. Geprueft wird jetzt
// Kettenzugehoerigkeit, Eintragungszeit <= generatedAt und Monotonie; die Regel selbst
// lebt in lib/druckenmiller/stamp.js, damit Schreiber und Test EINE Implementierung teilen.
const stamp = require('../../lib/druckenmiller/stamp.js');
const REG_A_REL = 'protocol/druckenmiller_loggers_registered_20260914.json';
const CHANGELOG_REL = 'tests/druckenmiller/fixtures/registration.CHANGELOG.md';
const assertPostHashRows = stamp.assertStampedRows;

test('R6 preRegistration: die Saat von Chunk 0 ist als vor-registriert deklariert und passt zur Reihe', () => {
  assert.equal(fileA.preRegistration, true, 'Datei A deklariert die Chunk-0-Zeilen nicht als vor-registriert');
  const p = fileA.preRegistrationRows;
  assert.ok(p && Number.isInteger(p.count) && p.count > 0, 'ohne Zeilenzahl ist die Deklaration nicht pruefbar');
  if (!fs.existsSync(LEDGER)) {
    // Im frischen Klon ohne Reihe kann der Abgleich nicht laufen — dann muss er das SAGEN.
    assert.ok(false, 'kein Ledger unter ' + LEDGER + ' — die Deklaration ist hier nicht pruefbar');
  }
  const rows = lies(LEDGER).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const vorRegistrierung = rows.filter((r) => r.date <= p.throughDate);
  assert.equal(vorRegistrierung.length, p.count,
    'Datei A nennt ' + p.count + ' vor-registrierte Zeilen, die Reihe hat ' + vorRegistrierung.length
    + ' bis ' + p.throughDate);
  assert.ok(p.throughDate < fileA.registeredOn,
    'die letzte vor-registrierte Zeile (' + p.throughDate + ') liegt nicht vor dem Registrierungs-Datum');
  const kette = stamp.digestChain(lies(CHANGELOG), REG_A_REL);
  assert.ok(kette.length, 'kein Changelog-Eintrag fuer ' + REG_A_REL + ' — der Stempel haette keine Kette');
  const heutiger = kette[kette.length - 1].digest;
  assert.equal(heutiger, sha256(fileAText),
    'die letzte Changelog-Zeile nennt ' + heutiger + ', Datei A ist ' + sha256(fileAText)
    + ' — die Datei wurde ohne Changelog-Zeile angefasst');
  const ergebnis = assertPostHashRows(rows, fileA, kette, stamp.entryTimes(REPO, CHANGELOG_REL, kette));
  // LEERLAUF-SPERRE: faellt die Zahl der geprueften Stempel je auf 0 (Filter verrutscht, ein
  // backfilled-Regress, ein verschobenes registeredOn), meldete die Pruefung frueher gruen,
  // ohne irgendetwas angesehen zu haben.
  assert.ok(ergebnis.stamped >= 1,
    'kein einziger Stempel geprueft (' + ergebnis.checked + ' Zeilen nach der Registrierung) — '
    + 'die T329-Pruefung laeuft auf dieser Reihe leer');
  assert.deepEqual(ergebnis.unverified, [],
    'diese Zeilen konnten nur auf Tagesaufloesung geprueft werden: '
    + JSON.stringify(ergebnis.unverified));
});

// Feste synthetische Historie: echte Aenderungen an Datei A duerfen dieses Orakel nie bewegen.
const A_DIGEST = 'a'.repeat(64), B_DIGEST = 'b'.repeat(64), C_DIGEST = 'c'.repeat(64);
const FREMD_DIGEST = 'f'.repeat(64);
const SYNTH_CHANGELOG = [
  `2026-09-14 · ${REG_A_REL} · ${A_DIGEST} · Initial registration`,
  `2026-09-14 * ${REG_A_REL} * ${B_DIGEST} * Same-day replacement`,
  `2026-09-20 * ${REG_A_REL} * ${C_DIGEST} * Later registration`,
].join('\n');
/** Ein utc-Eintrag, wie ihn entryTimes baut: Anwesenheits-Ereignisse, nicht ein Zeitpunkt. */
const utcEintrag = (date, ...ereignisse) => ({
  date,
  precision: 'utc',
  at: ereignisse[0][0],
  events: ereignisse.map(([at, kind]) => ({ at, ms: Date.parse(at), kind: kind || 'add' })),
});
const tagEintrag = (date, reason) => ({
  date, precision: 'day', at: null, events: null, reason: reason || 'Testfall ohne Ableitung',
});
const SYNTH_ZEITEN = new Map([
  [A_DIGEST, utcEintrag('2026-09-14', ['2026-09-14T10:00:00.000Z'])],
  [B_DIGEST, utcEintrag('2026-09-14', ['2026-09-14T18:00:00.000Z'])],
  [C_DIGEST, utcEintrag('2026-09-20', ['2026-09-20T11:40:47.000Z'])],
]);
const SYNTH_REG = { registeredOn: '2026-09-14', verifiedPostHashRows: [] };
const synthZeile = (date, stempel, generatedAt) => ({
  date, backfilled: false, constants_sha256: stempel, generatedAt,
});

test('R6b T329: Kettenzugehoerigkeit, Anwesenheit bei generatedAt, Monotonie', () => {
  const kette = stamp.digestChain(SYNTH_CHANGELOG, REG_A_REL);
  assert.deepEqual(kette.map((e) => e.digest), [A_DIGEST, B_DIGEST, C_DIGEST],
    'beide historischen Trenner muessen gelesen werden, und die Dateireihenfolge entscheidet');
  const pruefe = (rows) => assertPostHashRows(rows, SYNTH_REG, kette, SYNTH_ZEITEN);

  // (1) Kettenzugehoerigkeit: ein Stempel, den das Changelog nie nennt.
  assert.throws(() => pruefe([synthZeile('2026-09-21', FREMD_DIGEST, '2026-09-22T09:00:00Z')]),
    (e) => e.message.includes('2026-09-21') && e.message.includes(FREMD_DIGEST)
      && e.message.includes('keiner'));

  // (2) Anwesenheit: den Stand gab es beim Rechnen noch nicht.
  assert.throws(() => pruefe([synthZeile('2026-09-21', C_DIGEST, '2026-09-20T09:00:00Z')]),
    (e) => e.message.includes('nicht in main') && e.message.includes('2026-09-20T11:40:47'));
  assert.equal(pruefe([synthZeile('2026-09-21', C_DIGEST, '2026-09-22T09:00:00Z')]).stamped, 1);
  // Genau auf der Millisekunde ist noch erlaubt (<=, nicht <).
  assert.equal(pruefe([synthZeile('2026-09-21', C_DIGEST, '2026-09-20T11:40:47.000Z')]).stamped, 1);

  // (3) Monotonie: nach C darf keine spaetere Zeile auf B zurueckfallen.
  assert.throws(() => pruefe([
    synthZeile('2026-09-21', C_DIGEST, '2026-09-22T09:00:00Z'),
    synthZeile('2026-09-22', B_DIGEST, '2026-09-23T09:00:00Z'),
  ]), (e) => e.message.includes('rueckwaerts') && e.message.includes('2026-09-22'));
  // Derselbe Stempel zweimal ist kein Rueckwaertslauf, und die Pruefung sortiert selbst.
  assert.equal(pruefe([
    synthZeile('2026-09-22', C_DIGEST, '2026-09-23T09:00:00Z'),
    synthZeile('2026-09-21', C_DIGEST, '2026-09-22T09:00:00Z'),
  ]).stamped, 2);

  // Ohne verwertbares generatedAt ist gar nichts pruefbar — das sagt die Meldung auch.
  for (const schlecht of [undefined, '2026-09-21T10:00:00', '2026-09-21', 'gestern']) {
    assert.throws(() => pruefe([synthZeile('2026-09-21', C_DIGEST, schlecht)]),
      (e) => e.message.includes('generatedAt') && e.message.includes('2026-09-21'),
      'ein generatedAt ohne Zone darf nicht durchgehen: ' + String(schlecht));
  }
});

test('R6b2 T329 Revert: derselbe Digest zweimal in der Kette', () => {
  // Ein Revert von Datei A auf einen frueheren Stand erzeugt BYTE-GLEICH denselben Digest.
  // Die Rueckkehr zu ihm IST ein Rueckwaertslauf und muss auffallen; der Weg vorwaerts nicht.
  const changelog = [
    `2026-09-01 * ${REG_A_REL} * ${A_DIGEST} * erste`,
    `2026-09-02 * ${REG_A_REL} * ${B_DIGEST} * zweite`,
    `2026-09-03 * ${REG_A_REL} * ${A_DIGEST} * Revert auf die erste`,
  ].join('\n');
  const kette = stamp.digestChain(changelog, REG_A_REL);
  const zeiten = new Map([
    [A_DIGEST, utcEintrag('2026-09-01', ['2026-09-01T00:00:00.000Z'], ['2026-09-03T00:00:00.000Z'])],
    [B_DIGEST, utcEintrag('2026-09-02', ['2026-09-02T00:00:00.000Z'])],
  ]);
  const reg = { registeredOn: '2026-08-01', verifiedPostHashRows: [] };
  const gen = '2026-09-30T00:00:00Z';
  assert.throws(() => assertPostHashRows(
    [synthZeile('2026-09-20', B_DIGEST, gen), synthZeile('2026-09-21', A_DIGEST, gen)], reg, kette, zeiten),
  (e) => e.message.includes('rueckwaerts'), 'der echte Rueckschritt B -> A wurde durchgelassen');
  assert.equal(assertPostHashRows(
    [synthZeile('2026-09-20', A_DIGEST, gen), synthZeile('2026-09-21', B_DIGEST, gen)], reg, kette, zeiten).stamped,
  2, 'der legitime Weg A -> B wurde faelschlich rot');
});

test('R6b3 T329 Luecke: hinzugefuegt, entfernt, wieder hinzugefuegt', () => {
  // Die Zeile war im Januar da, im Februar weg, im Juni wieder da. Eine Zeile, die in der
  // Luecke gerechnet wurde, beruft sich auf einen Stand, den main damals nicht trug.
  const mitLuecke = utcEintrag('2026-01-02',
    ['2026-01-02T10:00:00.000Z', 'add'], ['2026-02-01T10:00:00.000Z', 'del'],
    ['2026-06-01T10:00:00.000Z', 'add']);
  assert.equal(stamp.presentAt(mitLuecke, Date.parse('2026-01-15T00:00:00Z')), true);
  assert.equal(stamp.presentAt(mitLuecke, Date.parse('2026-03-15T00:00:00Z')), false,
    'in der Luecke gilt der Stand als anwesend — genau der Falsch-Freispruch');
  assert.equal(stamp.presentAt(mitLuecke, Date.parse('2026-07-15T00:00:00Z')), true);
  assert.equal(stamp.presentAt(mitLuecke, Date.parse('2026-01-01T00:00:00Z')), false);
  assert.equal(stamp.entryNotAfterGenerated(mitLuecke, '2026-03-15T00:00:00Z').ok, false);
  assert.equal(stamp.entryNotAfterGenerated(mitLuecke, '2026-07-15T00:00:00Z').ok, true);
  // Und das Flag nimmt den Eintritt, der FUER DIESE ZEILE gilt, nicht den ersten.
  assert.equal(stamp.afterClose(mitLuecke, '2026-06-01', '2026-07-15T00:00:00Z').at,
    '2026-06-01T10:00:00.000Z');
});

test('R6c T329 GitHub-Re-Run: alter Commit mit neuem generatedAt — beide Richtungen', () => {
  const kette = stamp.digestChain(SYNTH_CHANGELOG, REG_A_REL);
  const pruefe = (rows) => assertPostHashRows(rows, SYNTH_REG, kette, SYNTH_ZEITEN);
  // GRUEN: der Re-Run laeuft auf dem alten Commit (Stempel B), das Zeilendatum liegt HINTER
  // der spaeteren Registrierung C. Die alte Gleichheitsregel verlangte hier C und faerbte
  // das Desk rot, obwohl an den Konstanten der Zeile nichts falsch ist.
  assert.equal(pruefe([synthZeile('2026-09-21', B_DIGEST, '2026-09-22T09:07:12.775Z')]).stamped, 1,
    'ein Re-Run auf altem Commit muss gruen sein — er stempelt den Stand, unter dem er rechnete');
  // ROT: derselbe Re-Run darf NICHT einen Stand stempeln, den es zur Rechenzeit noch nicht
  // gab. Das ist die Richtung, die die Regel weiterhin fangen muss.
  assert.throws(() => pruefe([synthZeile('2026-09-19', C_DIGEST, '2026-09-19T23:00:00Z')]),
    (e) => e.message.includes('nicht in main'));
});

test('R6d T329 Bruecken-Flag: nach Handelsschluss eingetragen, aber nie blockiert', () => {
  // 16:00 America/New_York, ueber beide Zeitzonen-Haelften UND ueber die Umstellungstage.
  const schluss = (d) => new Date(stamp.closeOfTradingDayUTC(d)).toISOString();
  assert.equal(schluss('2026-09-21'), '2026-09-21T20:00:00.000Z');
  assert.equal(schluss('2026-12-15'), '2026-12-15T21:00:00.000Z');
  assert.equal(schluss('2026-03-07'), '2026-03-07T21:00:00.000Z', 'Tag VOR der Umstellung');
  assert.equal(schluss('2026-03-08'), '2026-03-08T20:00:00.000Z', 'Umstellungstag im Fruehjahr');
  assert.equal(schluss('2026-10-31'), '2026-10-31T20:00:00.000Z');
  assert.equal(schluss('2026-11-01'), '2026-11-01T21:00:00.000Z', 'Umstellungstag im Herbst');
  // Ein Datum, das es nicht gibt, liefert KEINE Zahl (Number('') waere 0 und endlich).
  for (const kaputt of ['kein-datum', '--', '2026-13-45', '2026-02-30', '', '2026-9-1']) {
    assert.throws(() => stamp.closeOfTradingDayUTC(kaputt), /Datum|Kalendertag/,
      'unlesbares Datum still akzeptiert: ' + JSON.stringify(kaputt));
  }

  const gen = '2026-09-22T09:00:00Z';
  const vorSchluss = utcEintrag('2026-09-21', ['2026-09-21T19:59:59.000Z']);
  const nachSchluss = utcEintrag('2026-09-21', ['2026-09-21T20:00:01.000Z']);
  assert.equal(stamp.afterClose(vorSchluss, '2026-09-21', gen).value, false);
  assert.equal(stamp.afterClose(nachSchluss, '2026-09-21', gen).value, true);

  // TAGESAUFLOESUNG: nur die Richtung "danach" ist entscheidbar. Ein FRUEHERES Datum sagt
  // gar nichts — in diesem Repo lagen zwischen Zeilendatum und Eintritt fuenf Tage.
  assert.equal(stamp.afterClose(tagEintrag('2026-09-22'), '2026-09-21', gen).value, true);
  for (const d of ['2026-09-20', '2026-09-21']) {
    const r = stamp.afterClose(tagEintrag(d), '2026-09-21', gen);
    assert.equal(r.value, null, 'aus dem Zeilendatum ' + d + ' wurde ein gemessenes false gemacht');
    assert.match(r.detail, /nicht entscheidbar/);
  }

  // Die zwei Felder, die der Schreiber anhaengt — genau die Entscheidung, keine Kulisse.
  assert.deepEqual(stamp.stampFields(nachSchluss, '2026-09-21', gen),
    { constantsAfterClose: true, constantsEntryPrecision: 'utc' });
  assert.deepEqual(stamp.stampFields(vorSchluss, '2026-09-21', gen),
    { constantsAfterClose: false, constantsEntryPrecision: 'utc' });
  const unklar = stamp.stampFields(tagEintrag('2026-09-20'), '2026-09-21', gen);
  assert.equal(unklar.constantsAfterClose, null, 'unentscheidbar darf nie false werden');
  assert.match(unklar.warn, /nicht gemessen/);
  assert.equal(stamp.stampFields(vorSchluss, '2026-09-21', gen).warn, undefined,
    'ein entschiedener Fall darf keine Warnung erzeugen — sonst verliert die Warnung ihren Wert');

  // Tor C wurde NICHT uebernommen: eine nach Handelsschluss gestempelte Zeile ist gueltig.
  const kette = stamp.digestChain(SYNTH_CHANGELOG, REG_A_REL);
  assert.equal(assertPostHashRows(
    [synthZeile('2026-09-19', C_DIGEST, '2026-09-21T09:00:00Z')], SYNTH_REG, kette,
    new Map([[C_DIGEST, utcEintrag('2026-09-20', ['2026-09-19T23:30:00.000Z'])]]),
  ).stamped, 1, 'eine nach Handelsschluss eingetragene Konstante blockiert die Zeile nicht');
});

test('R6e T329 die Eintragungszeit wird WIRKLICH aus dem Merge abgeleitet', () => {
  // Der Kern des Ratsbeschlusses. Ohne diesen Test bliebe die Suite gruen, wenn die
  // Ableitung gar nicht liefe — der Tages-Rueckfall wuerde jede Zeile stillschweigend
  // durchwinken (Review-Fund, mit gestopfter git-Funktion reproduziert).
  assert.equal(stamp.derivationBlocker(REPO, CHANGELOG_REL), null,
    'auf diesem Repo darf nichts die Ableitung blockieren (flacher Klon? Umbenennung?)');
  const kette = stamp.digestChain(lies(CHANGELOG), REG_A_REL);
  const zeiten = stamp.entryTimes(REPO, CHANGELOG_REL, kette);
  assert.equal(zeiten.size, kette.length, 'jede Kettenzeile braucht einen Zeiteintrag');
  const utc = [...zeiten.values()].filter((z) => z.precision === 'utc');
  assert.equal(utc.length, kette.length,
    'nur ' + utc.length + ' von ' + kette.length + ' Digests haben eine abgeleitete Zeit — '
    + 'die Merge-Ableitung liefert hier nicht, und der Rest liefe auf Tagesaufloesung');
  for (const e of kette) {
    const z = zeiten.get(e.digest);
    assert.ok(Array.isArray(z.events) && z.events.length, 'keine Ereignisse fuer ' + e.digest);
    assert.match(z.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Der Merge kann NACH dem Datum der Zeile liegen (die Saat kam gesammelt nach main),
    // aber niemals davor: dann waere der Eintrag aelter als der Text, der ihn einfuehrt.
    assert.ok(z.at.slice(0, 10) >= e.date,
      e.digest + ': Merge ' + z.at + ' liegt vor der Changelog-Zeile ' + e.date);
  }
  // BRUCHPROBE: ohne brauchbares Repo gibt es KEINE erfundene Uhrzeit, sondern
  // Tagesaufloesung MIT Grund — und die Pruefung verliert sichtbar ihre Verifikation.
  const kaputt = stamp.entryTimes(path.join(REPO, 'gibt-es-nicht'), CHANGELOG_REL, kette);
  for (const z of kaputt.values()) {
    assert.equal(z.precision, 'day');
    assert.equal(z.at, null, 'ohne Ableitung darf keine Uhrzeit dastehen');
    assert.ok(z.reason && z.reason.length > 10, 'Tagesaufloesung ohne Begruendung');
  }
  assert.equal(stamp.entryNotAfterGenerated([...kaputt.values()][0], '2099-01-01T00:00:00Z').verified,
    false, 'eine nicht abgeleitete Zeit darf sich nicht als verifiziert ausgeben');
});

test('R6a BRUCHPROBEN: provenance, wrong digest, backfill and missing backfill flag', () => {
  const digest = sha256(fileAText);
  const kette = stamp.digestChain(lies(CHANGELOG), REG_A_REL);
  const zeiten = stamp.entryTimes(REPO, CHANGELOG_REL, kette);
  const date = '2099-01-02';
  const gen = '2099-01-03T00:00:00.000Z';
  const registration = { registeredOn: fileA.registeredOn, verifiedPostHashRows: [{ date: '2026-09-18' }] };
  const check = (row) => assertPostHashRows([row], registration, kette, zeiten);
  const missing = (e) => e.message.includes(date) && e.message.includes('no constants_sha256');
  assert.throws(() => check({ date, backfilled: false, generatedAt: gen }), missing);
  const wrong = '0'.repeat(64);
  const wrongDigest = (day) => (e) => e.message.includes(day)
    && e.message.includes(wrong) && e.message.includes(digest);
  assert.throws(() => check({ date, constants_sha256: wrong, generatedAt: gen }), wrongDigest(date));
  assert.equal(check({ date, backfilled: true, constants_sha256: wrong, generatedAt: gen }).checked, 0);
  assert.throws(() => check({ date, generatedAt: gen }), missing);
  assert.equal(check({ date, constants_sha256: digest, generatedAt: gen }).stamped, 1);
  assert.equal(check({ date: '2026-09-18', generatedAt: gen }).stamped, 0, 'Provenienz-Zeile traegt keinen Stempel');
  assert.throws(() => check({ date: '2026-09-18', constants_sha256: wrong, generatedAt: gen }),
    wrongDigest('2026-09-18'));
  for (const invalid of [null, '']) {
    assert.throws(() => check({ date: '2026-09-18', constants_sha256: invalid, generatedAt: gen }),
      /2026-09-18/);
  }
  // LEERLAUF-SPERRE: ohne gueltiges registeredOn filtert die Pruefung jede Zeile weg und
  // meldete frueher gruen. Ein Stempel, den die Kette nicht kennt, muss auffallen.
  for (const kaputt of [{}, { registeredOn: undefined }, { registeredOn: 'irgendwann' }]) {
    assert.throws(() => assertPostHashRows(
      [{ date, constants_sha256: wrong, generatedAt: gen }], kaputt, kette, zeiten),
    /registeredOn/, 'ein kaputtes registeredOn lief leer durch: ' + JSON.stringify(kaputt));
  }
  assert.throws(() => assertPostHashRows(null, registration, kette, zeiten), /Zeilen-Array/);

  const logger = require('../../scripts/druckenmiller-log-internals.js');
  const gelesen = logger.registrierungenLesen(path.dirname(FILE_A), () => {});
  assert.equal(gelesen.constants_sha256, digest, 'the logger must forward the digest returned by readHashed');
  assert.equal(logger.CHANGELOG_REL, CHANGELOG_REL,
    'Schreiber und Waechter stempeln gegen verschiedene Changelog-Pfade');
  // T329: der Schreiber braucht die Eintragungszeit, sonst kann er das Flag nicht setzen.
  const prov = logger.stempelProvenienz(path.dirname(FILE_A), gelesen.dateiA, digest, () => {});
  assert.equal(prov.eintrag.precision, 'utc',
    'der Schreiber bekaeme nur Tagesaufloesung — dann stuende im Ledger ein ungemessenes Flag');
  assert.ok(prov.kette.some((e) => e.digest === digest),
    'die Kette des Schreibers enthaelt den heutigen Stempel nicht');
  // BRUCHPROBE: ein Stempel ohne Changelog-Zeile darf NICHT stillschweigend durchgehen.
  assert.throws(() => logger.stempelProvenienz(path.dirname(FILE_A), gelesen.dateiA, wrong, () => {}),
    (e) => e.message.includes(wrong) && e.message.includes('Changelog-Zeile'));
});

test('R7 Datei A registriert genau das, wofuer sie zustaendig ist — und nichts aus Datei B/C', () => {
  const text = fileAText;
  for (const fremd of ['"tercile', '"k":', 'coolOff', 'blockFloor', 'intervalDirection', 'powerProjection',
    'readSchedule', 'alphaStar']) {
    assert.ok(!text.includes(fremd),
      'Datei A enthaelt ' + fremd + ' — das gehoert in Datei B (Ende Chunk 2) und wuerde hier '
      + 'VOR der Messung eingefroren, obwohl der Rat es dort verortet hat');
  }
  for (const pflicht of ['l3Band', 'l4bNamedIndustries', 'greyOutMinCoverage', 'freshnessMinShare',
    'churnMaxShare', 'rIntLoggedOnly', 'minBars', 'overrideNoteD1']) {
    assert.ok(text.includes(pflicht), 'Datei A registriert ' + pflicht + ' nicht');
  }
  assert.equal(fileA.schema, 'druckenmiller-loggers-registered/1');
  assert.equal(fileA.hashedInChunk, 1);
});

test('R8 WAECHTER am Ding: der highChurn-Ausschluss braucht einen Produzenten, bevor R-INT liest', () => {
  // REVIEW-FUND (beide Reviewer, uebereinstimmend): quantileInput und rIntRankMean filtern
  // highChurn — aber KEIN Produzent schreibt das Feld je in eine Ledger-Zeile. Der Churn
  // entsteht schreiber-seitig in regime.json; LEDGER_ROW_FIELDS kennt das Feld nicht (und ein
  // neues Pflichtfeld haette alle Bestandszeilen im --check rot gemacht: "Feld … fehlt").
  // Folgenlos, solange R-INT null ist — R-INT braucht 250 quantilfaehige Live-Tage. Dieser
  // Waechter haengt deshalb an genau dieser Bedingung: er wird rot, BEVOR die erste
  // R-INT-Zahl aus Sitzungen entstehen kann, deren Churn niemand kennt.
  const internals = require('../../lib/druckenmiller/internals.js');
  const ledger = require('../../lib/druckenmiller/ledger.js');
  const hatFeld = internals.LEDGER_ROW_FIELDS.includes('highChurn');
  if (!fs.existsSync(LEDGER)) { assert.ok(false, 'kein Ledger — nicht pruefbar'); }
  const rows = lies(LEDGER).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const quantilfaehig = ledger.quantileInput(rows).length;
  const grenze = internals.MIN_LIVE_TAGE_FUER_ZUSTAND;
  if (!hatFeld) {
    assert.ok(quantilfaehig < grenze,
      'die Reihe hat ' + quantilfaehig + ' quantilfaehige Zeilen (Grenze ' + grenze + '), aber '
      + 'LEDGER_ROW_FIELDS traegt kein highChurn. Ab jetzt speisen umgeschlagene Sitzungen R-INT, '
      + 'obwohl Datei A (rIntLoggedOnly.quantileWindowExcludes) sie ausschliesst. Chunk 2 muss '
      + 'entweder das Feld in die Ledger-Zeile schreiben (mit Changelog-Zeile fuer den '
      + 'ROW_FIELDS-Schnappschuss) oder die Flagge aus regime.json lesen.');
    assert.ok(rows.every((r) => !Object.prototype.hasOwnProperty.call(r, 'highChurn')),
      'eine Ledger-Zeile traegt highChurn, die eingefrorene Feldliste aber nicht — die beiden '
      + 'sind auseinandergelaufen');
  } else {
    // Sobald es das Feld gibt, wird der Ausschluss auf ECHTEN Daten gemessen, nicht mehr an
    // einer selbstgebauten Zeile.
    const markiert = rows.filter((r) => r.highChurn === true);
    assert.equal(ledger.quantileInput(rows).filter((r) => r.highChurn === true).length, 0,
      'es gibt ' + markiert.length + ' highChurn-Zeilen, und der Ausschluss laesst sie durch');
  }
});

// ---------------------------------------------------------------------------
// Datei B und Datei C (Chunk 2). Fuer sie ist der Test STRENG ([REV7-3]): sie werden
// gehasht, BEVOR die erste gewertete Zeile existiert - also darf keine gewertete Zeile vor
// dem Hash-Datum liegen, und jede Zahl muss dem Vergleichsmassstab entsprechen.
// ---------------------------------------------------------------------------
const FILE_B = path.join(REPO, 'protocol', 'druckenmiller_scoreboard_registered_20260919.json');
const FILE_C = path.join(REPO, 'protocol', 'druckenmiller_alfred_registered_20260919.json');
const AMENDMENT = path.join(REPO, 'protocol', 'BUILD-SPEC-v1-AMENDMENT-01-barrier-scaling.md');
const AMENDMENT_02 = path.join(REPO, 'protocol', 'BUILD-SPEC-v1-AMENDMENT-02-chunk4-power-policy.md');
const K_LEDGER = path.join(REPO, 'druckenmiller-history', 'candidates-ledger.jsonl');
const scoreboard = require('../../lib/druckenmiller/scoreboard.js');
const confirmation = require('../../lib/druckenmiller/confirmation.js');
const scoreboardRead = require('../../lib/druckenmiller/scoreboard-read.js');

test('R9 Datei B und Datei C: Hash = Sidecar = Changelog-Zeile (Residuum 4, jetzt fuer drei Dateien)', () => {
  for (const [datei, name] of [[FILE_B, 'Datei B'], [FILE_C, 'Datei C'], [AMENDMENT, 'AMENDMENT 01'],
                               [AMENDMENT_02, 'AMENDMENT 02']]) {
    assert.ok(fs.existsSync(datei), name + ' fehlt');
    const hash = sha256(lies(datei));
    const sidecar = lies(datei + '.sha256').trim().split(/\s+/)[0];
    assert.equal(hash, sidecar, name + ': Sidecar und Datei stimmen nicht ueberein');
    if (datei !== AMENDMENT) {   // AMENDMENT 01 predates the changelog convention; 02 carries its own line
      assert.ok(lies(CHANGELOG).includes(hash),
        name + ': der Hash steht in keiner Changelog-Zeile - eine Registrierung ohne Eintrag ist eine stille');
    }
  }
  // Und das Amendment ist in BEIDEN Registrierungen mit demselben Hash genannt.
  const hA = sha256(lies(AMENDMENT));
  assert.equal(JSON.parse(lies(FILE_B))._amendment01.sha256, hA);
  assert.equal(JSON.parse(lies(FILE_C))._amendment01.sha256, hA);
});

test('R10 jede Zahl aus Datei B und C steht so im Vergleichsmassstab (kanonisch)', () => {
  const b = JSON.parse(lies(FILE_B));
  const c = JSON.parse(lies(FILE_C));
  const soll = JSON.parse(lies(SPEC_CONSTANTS));
  const sb = soll.scoreboardB, sc = soll.alfredC;
  const paare = [
    [b.m1.lookbackBars, sb.m1.lookbackBars], [b.m1.lagBars, sb.m1.lagBars],
    [b.m1.volWindowBars, sb.m1.volWindowBars], [b.m2.windowBars, sb.m2.windowBars],
    [kanonisch(b.terciles.quantiles), kanonisch(sb.terciles.quantiles)],
    [b.terciles.minStatedN, sb.terciles.minStatedN],
    [b.barrier.k, sb.barrier.k], [b.barrier.sigmaWindowBars, sb.barrier.sigmaWindowBars],
    [b.barrier.sigmaScaling, sb.barrier.sigmaScaling],
    [kanonisch(b.horizons), kanonisch(sb.horizons)], [b.decisiveArm, sb.decisiveArm],
    [kanonisch(b.entryRule.coolOffBars), kanonisch(sb.coolOffBars)],
    [kanonisch(b.blockFloor), kanonisch(sb.blockFloor)],
    [b.bootstrap.B, sb.bootstrap.B], [b.bootstrap.seed, sb.bootstrap.seed],
    [b.bootstrap.wildBelowBlocks, sb.bootstrap.wildBelowBlocks],
    [kanonisch(b.bootstrap.blockLengthBars), kanonisch(sb.bootstrap.blockLengthBars)],
    [b.alphaRead, sb.alphaRead], [kanonisch(b.alphaStar), kanonisch(sb.alphaStar)],
    [b.beta, sb.beta], [b.intervalDirection, sb.intervalDirection],
    [kanonisch(b.labelBounds), kanonisch(sb.labelBounds)],
    [b.retirement.mdeBoundPp, sb.retirement.mdeBoundPp],
    [kanonisch(b.retirement.evaluatedAt), kanonisch(sb.retirement.evaluatedAt)],
    [b.separationGate.maxConfirmsShare, sb.separationGate.maxConfirmsShare],
    [b.separationGate.minConfirmsShare, sb.separationGate.minConfirmsShare],
    [b.warmup.liveSessions, sb.warmup.liveSessions],
    [kanonisch(b.armCollapseGuard.ksScaledMin), kanonisch(sb.armCollapseGuard.ksScaledMin)],
    [kanonisch(b.armCollapseGuard.medianRatioMin), kanonisch(sb.armCollapseGuard.medianRatioMin)],
    [kanonisch(b.panelDisplay.frozen), kanonisch(sb.panelDisplay.frozen)],
    [kanonisch(b.panelDisplay.live), kanonisch(sb.panelDisplay.live)],
    [b.powerProjection, sb.powerProjection],
    [c.vintages.spanEnd, sc.spanEnd], [c.inference.blockLengthWeeks, sc.blockLengthWeeks],
    [c.inference.B, sc.B], [c.inference.seed, sc.seed], [c.inference.alpha, sc.alpha],
    [c.inference.minBlocks, sc.minBlocks],
  ];
  for (let i = 0; i < paare.length; i++) {
    assert.deepEqual(paare[i][0], paare[i][1], 'Paar ' + i + ' weicht ab: '
      + JSON.stringify(paare[i][0]) + ' vs ' + JSON.stringify(paare[i][1]));
  }
  assert.equal(b.powerProjection, null, 'powerProjection MUSS der NULL-Platzhalter sein ([REV4-3])');
});

test('R11 der laufende Code traegt genau die Werte aus Datei B (Muster R5)', () => {
  const b = JSON.parse(lies(FILE_B));
  assert.equal(scoreboard.K, b.barrier.k);
  assert.equal(scoreboard.SIGMA_WINDOW, b.barrier.sigmaWindowBars);
  assert.deepEqual(scoreboard.HORIZONS, b.horizons);
  assert.equal(scoreboard.DECISIVE_ARM, b.decisiveArm);
  assert.equal(scoreboard.BLOCK_FLOOR[63], b.blockFloor['63']);
  assert.equal(scoreboard.BLOCK_FLOOR[126], b.blockFloor['126']);
  assert.equal(scoreboard.WARMUP_SESSIONS, b.warmup.liveSessions);
  assert.equal(scoreboard.ALPHA_STAR_TWO_ARM, b.alphaStar.twoArm);
  assert.equal(scoreboard.ALPHA_STAR_ONE_ARM, b.alphaStar.singleArm);
  assert.equal(scoreboard.BETA, b.beta);
  assert.equal(scoreboard.KNOWLEDGE_BAR_PP, b.labelBounds.knowledgeBarPp);
  assert.equal(scoreboard.TRADE_BAR_PP, b.labelBounds.tradeBarPp);
  assert.equal(scoreboard.RETIRE_MDE_PP, b.retirement.mdeBoundPp);
  assert.deepEqual(scoreboard.PANEL_FROZEN_FIELDS, b.panelDisplay.frozen);
  assert.deepEqual(scoreboard.PANEL_LIVE_FIELDS, b.panelDisplay.live);
  assert.equal(confirmation.M1_LOOKBACK, b.m1.lookbackBars);
  assert.equal(confirmation.M1_LAG, b.m1.lagBars);
  assert.equal(confirmation.VOL_WINDOW, b.m1.volWindowBars);
  assert.equal(confirmation.HIGH_WINDOW, b.m2.windowBars);
  assert.equal(confirmation.SIGMA_WINDOW, b.barrier.sigmaWindowBars);
  assert.equal(confirmation.SEPARATION_MAX, b.separationGate.maxConfirmsShare);
  assert.equal(confirmation.SEPARATION_MIN, b.separationGate.minConfirmsShare);
  assert.equal(scoreboardRead.B_DEFAULT, b.bootstrap.B);
  assert.equal(scoreboardRead.SEED_DEFAULT, b.bootstrap.seed);
  assert.equal(scoreboardRead.WILD_MAX_BLOCKS, b.bootstrap.wildBelowBlocks);
  // Die vier Etiketten woertlich, in der registrierten Reihenfolge.
  assert.deepEqual(scoreboard.LABELS.map((l) => l.text), b.labels.map((l) => l.text));
  assert.deepEqual(scoreboard.LABELS.map((l) => l.id), b.labels.map((l) => l.id));
});

test('R12 STRENG: vor dem Hash von Datei B gibt es keine GEWERTETE Zeile, und T0 steht', () => {
  const b = JSON.parse(lies(FILE_B));
  assert.equal(b.T0, '2026-09-19', 'T0 ist das Hash-Datum');
  assert.ok(lies(CHANGELOG).includes(b.T0), 'das Hash-Datum steht in der Changelog-Zeile');
  if (!fs.existsSync(K_LEDGER)) return;               // noch kein Kandidaten-Ledger im Repo
  const zeilen = lies(K_LEDGER).split('\n').filter((z) => z.trim()).map((z) => JSON.parse(z));
  const gewertet = [];
  for (const r of zeilen) {
    for (const e of r.entries || []) if (e.warmup !== true) gewertet.push(e);
  }
  const vorT0 = gewertet.filter((e) => e.date < b.T0);
  assert.deepEqual(vorT0, [], 'es gibt gewertete Eintraege VOR dem Registrierungs-Hash: '
    + vorT0.map((e) => e.ticker + '@' + e.date).join(', '));
});

console.log('\nregistration.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
