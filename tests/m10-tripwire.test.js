'use strict';
/**
 * M10 / M8-M16 — Waechter des Identitaets-Tripwires.
 * Urteil: `agent-reports/_COURT-M10-2026-08-30.md` (ENTSCHIED 126), Auflagen M8, M9, M10, M11,
 * M12, M14, M15, M16.
 *
 * DIE WAECHTER-AUFLAGE (M14, 3:0, dazu Karls stehende Regel) ist hier woertlich umgesetzt:
 * Verankerung AM OBJEKT, nicht am Textmuster; ANWESENHEIT UND ABWESENHEIT je Anker; beide
 * Richtungen einmal absichtlich gebrochen, bevor „fertig" gesagt wird (Bruchnachweis im
 * PR-Koerper).
 *
 * WAS AUF DEM SPIEL STEHT — und es ist NICHT die Ausbeute des Ankers:
 *  (1) Der Baustein darf KEINE ZEILE ANFASSEN. Er meldet. Faellt diese Wache, ist aus einer
 *      Lampe ein Tor geworden — und das Voll-Tor (A11/c1) ist 2:1 GESPERRT.
 *  (2) Der Lauf darf NIE an ihm sterben (fail-open). In derselben Datei hat eine
 *      Vorstufen-Reihenfolge schon einmal einen harten Tageslauf-Abbruch verursacht; das
 *      kostet die Tagesfrische aller ~15.000 Zeilen — verursacht von einer Lampe ohne
 *      Datenwirkung.
 *  (3) Die Degradation muss SICHTBAR sein. Eine still ausfallende Lampe ist keine Lampe.
 *  (4) Die KGaA-Ausnahme haengt an der RECHTSFORM der Zeile, nie an einer Ticker-Liste —
 *      eine Ticker-Liste waere die Handliste, die dasselbe Gericht unter G7 ablehnt.
 *  (5) M15: kein `exchanges[]`, keine Waehrungs-Umrechnungsregel im Anker-Pfad.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/m10-tripwire.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  tripwireAnkerA, tripwireAnkerB, tripwireLesen, tripwireBericht, tripwireStandardpfad,
  TRIPWIRE_A_BAND, TRIPWIRE_KOMPLEMENTAERFORM, umbenennungsProtokoll,
  tripwireKlassen, tripwireKlassenSchluessel, TRIPWIRE_KLASSEN_BEISPIELE,
} = require('../scripts/filter-snapshot-merge.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const SKRIPT = path.join(__dirname, '..', 'scripts', 'filter-snapshot-merge.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'm10-tw-'));

/** Rohzeile in der Form, die `tripwireLesen` liefert. Am OBJEKT: dieselben Felder, dieselbe
 *  Bedeutung — kein Nachbau der Anker-Regel im Test. */
function zeile(ticker, name, o = {}) {
  return {
    ticker, name, nameSource: o.nameSource || 'fehlt',
    schluessel: o.schluessel !== undefined ? o.schluessel : name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    shares: o.shares, jahresAktien: o.jahresAktien,
    hatUmsatz: o.fp !== undefined, fingerabdruck: o.fp,
  };
}

// ─── 1. ANKER A: Anwesenheit und Abwesenheit ────────────────────────────────────────────

test('A-ANWESENHEIT: der belegte Selbstwiderspruch (VMRK-Form, 2,79) feuert', () => {
  // Die echten Zahlen aus data-health/quarantine.json: gemeldete 398.834.711 gegen die eigene
  // Jahresreihe 142.826.382.
  const r = tripwireAnkerA([zeile('VMRK', 'Vivmark Residential', { shares: 398834711, jahresAktien: 142826382 })]);
  assert.equal(r.treffer.length, 1);
  assert.equal(r.treffer[0].anker, 'A');
  assert.ok(Math.abs(r.treffer[0].wert - 2.792) < 0.001, 'der Wert steht in der Meldung, nicht nur ein Boolean');
  assert.equal(r.ausgenommen, 0);
});

test('A-ABWESENHEIT: eine saubere Zeile (AVBC.VI, 1,000) feuert NICHT', () => {
  // Ohne diese Richtung waere die Wache oben mit einem Anker gruen, der JEDE Zeile meldet.
  const r = tripwireAnkerA([zeile('AVBC.VI', 'AvalonBay Communities Inc', { shares: 142797963, jahresAktien: 142826382 })]);
  assert.deepEqual(r.treffer, []);
});

test('A: die Bandgrenzen sind EINGESCHLOSSEN, knapp daneben feuert es', () => {
  const bei = (v) => tripwireAnkerA([zeile('X', 'Acme Inc', { shares: v * 1e6, jahresAktien: 1e6 })]).treffer.length;
  assert.equal(bei(TRIPWIRE_A_BAND[0]), 0, 'die untere Grenze selbst ist noch sauber');
  assert.equal(bei(TRIPWIRE_A_BAND[1]), 0, 'die obere Grenze selbst ist noch sauber');
  assert.equal(bei(TRIPWIRE_A_BAND[0] - 0.01), 1);
  assert.equal(bei(TRIPWIRE_A_BAND[1] + 0.01), 1);
});

test('A: eine Zeile ohne rechenbare Basis wird GEZAEHLT, nicht als sauber verbucht', () => {
  // "Nicht messbar" ist kein Negativbefund. Ohne den eigenen Zaehler waere ein Feed-Ausfall
  // ueber den halben Bestand von einem stillen, sauberen Tag nicht zu unterscheiden.
  const r = tripwireAnkerA([
    zeile('A1', 'Ohne Reihe AG', { shares: 1000, jahresAktien: null }),
    zeile('A2', 'Ohne Zahl AG', { shares: null, jahresAktien: 1000 }),
    zeile('A3', 'Null AG', { shares: 0, jahresAktien: 1000 }),
  ]);
  assert.deepEqual(r.treffer, []);
  assert.equal(r.ohneBasis, 3);
});

// ─── 2. M12: die Ausnahme haengt an der RECHTSFORM, nicht an einem Ticker ────────────────

test('M12-ABWESENHEIT: die KGaA-Fixture feuert NICHT (MRK.DE-Form, 0,297)', () => {
  const r = tripwireAnkerA([zeile('MRK.DE', 'Merck KGaA', { shares: 129242252, jahresAktien: 434777878 })]);
  assert.deepEqual(r.treffer, [], 'nur ~30 % des Kapitals sind notiert — das ist KEIN Befund');
  assert.equal(r.ausgenommen, 1, 'die Ausnahme wird gezaehlt; eine unzaehlbare Ausnahme ist von einem toten Anker nicht zu unterscheiden');
});

test('M12-ANWESENHEIT: dieselben Zahlen ohne Komplementaer-Rechtsform feuern sehr wohl', () => {
  // DIE entscheidende Gegenrichtung: die Ausnahme darf am STRUKTURMERKMAL haengen, nicht am
  // Zahlenbereich. Waere sie versehentlich als Wertebereich gebaut, bliebe diese Zeile still.
  const r = tripwireAnkerA([zeile('XXX', 'Merck Beteiligungs AG', { shares: 129242252, jahresAktien: 434777878 })]);
  assert.equal(r.treffer.length, 1);
  assert.equal(r.ausgenommen, 0);
});

test('M12: die Ausnahme traegt die ganze KLASSE, nicht einen Einzelfall', () => {
  const formen = ['Merck KGaA', 'Draegerwerk AG & Co. KGaA', 'Henkel AG & Co. KGaA',
    'Empire State Realty OP, L.P.', 'Icahn Enterprises L.P.', 'MACH NATURAL RESOURCES LP',
    'Plains GP Holdings, L.P.'];
  for (const n of formen) assert.ok(TRIPWIRE_KOMPLEMENTAERFORM.test(n), `${n} ist eine Komplementaer-/Partnership-Struktur`);
  for (const n of ['AvalonBay Communities Inc', 'Merck & Co., Inc.', 'Vivmark Residential', 'Siemens Energy AG']) {
    assert.ok(!TRIPWIRE_KOMPLEMENTAERFORM.test(n), `${n} darf NICHT ausgenommen sein`);
  }
});

test('M12: im Anker-Code steht KEINE Ticker-Liste', () => {
  // Auflage M12, woertlicher Beweis: `git grep "MRK.DE"` im Anker-Code => 0 Treffer. Eine
  // Ticker-Liste waere selbst die Handliste, die dieses Gericht unter G7 ablehnt.
  const quelle = fs.readFileSync(SKRIPT, 'utf8');
  const ankerBlock = quelle.slice(quelle.indexOf('const TRIPWIRE_KOMPLEMENTAERFORM'), quelle.indexOf('function tripwireBericht'));
  assert.ok(ankerBlock.length > 100, 'Vorbedingung: der Anker-Block wurde gefunden');
  assert.ok(!/MRK\.DE|['"]VMRK['"]|MRCK\.VI/.test(ankerBlock),
    'kein Ticker im Anker-Pfad — die Ausnahme haengt am Objekt');
});

// ─── 3. ANKER B: Anwesenheit und Abwesenheit ────────────────────────────────────────────

const FP_AVB = '[3040725000,2913757000,2767909000,2593446000]|null';

test('B-ANWESENHEIT: dieselbe Reihe ueber ZWEI Emittentengruppen feuert', () => {
  const r = tripwireAnkerB([
    zeile('AVB', 'AvalonBay Communities Inc', { fp: FP_AVB }),
    zeile('VMRK', 'Vivmark Residential', { fp: FP_AVB }),
  ]);
  assert.equal(r.treffer.length, 1);
  assert.equal(r.treffer[0].wert, 2, 'der Wert ist die Zahl der beteiligten Emittentengruppen');
  assert.deepEqual(r.treffer[0].beine.map((b) => b.ticker), ['AVB', 'VMRK']);
});

test('B-ABWESENHEIT: dieselbe Reihe INNERHALB einer Gruppe feuert NICHT', () => {
  // Der Normalfall der Zweitnotierung. Ohne diese Richtung meldete B jede Doppelnotierung im
  // Bestand — und waere binnen einer Woche eine Lampe, die niemand mehr liest.
  const r = tripwireAnkerB([
    zeile('AVB', 'AvalonBay Communities Inc', { fp: FP_AVB }),
    zeile('AVBC.VI', 'AvalonBay Communities Inc', { fp: FP_AVB }),
  ]);
  assert.deepEqual(r.treffer, []);
});

test('B-ABWESENHEIT: VERSCHIEDENE Reihen feuern nicht, egal wie fremd die Namen sind', () => {
  const r = tripwireAnkerB([
    zeile('AVB', 'AvalonBay Communities Inc', { fp: FP_AVB }),
    zeile('MRK', 'Merck & Co., Inc.', { fp: '[65011000000,64168000000]|null' }),
  ]);
  assert.deepEqual(r.treffer, []);
});

test('B: ein Bein ohne Kurs matcht mit NICHTS (fail-closed, A7-FX-Bauform)', () => {
  // `milanFingerabdruck` setzt ohne `meta.fxRateApplied` den Platzhalter `OHNE-FX:<ticker>`.
  // Zwei kurslose Beine duerfen daran NICHT zueinanderfinden — sonst erfaende der Anker Klassen.
  const r = tripwireAnkerB([
    zeile('A1', 'Alpha AG', { fp: 'OHNE-FX:A1' }),
    zeile('B1', 'Beta SA', { fp: 'OHNE-FX:B1' }),
  ]);
  assert.deepEqual(r.treffer, []);
});

test('B: eine Zeile ohne Umsatzreihe nimmt gar nicht teil', () => {
  const r = tripwireAnkerB([
    zeile('A1', 'Alpha AG', { fp: FP_AVB }),
    { ...zeile('B1', 'Beta SA', { fp: FP_AVB }), hatUmsatz: false },
  ]);
  assert.deepEqual(r.treffer, []);
});

// ─── 4. M9 / M11: die Meldeform ─────────────────────────────────────────────────────────

test('M11: A und B sind ZWEI Zaehlgroessen, nie ein verschmolzenes Boolean', () => {
  const a = tripwireAnkerA([zeile('VMRK', 'Vivmark Residential', { shares: 398834711, jahresAktien: 142826382 })]);
  const b = tripwireAnkerB([zeile('AVB', 'AvalonBay Communities Inc', { fp: FP_AVB }), zeile('VMRK', 'Vivmark Residential', { fp: FP_AVB })]);
  const ber = tripwireBericht(a, b, { stand: '2026-08-30', gelesen: 2, unlesbar: 0, messebene: 'x' });
  assert.equal(ber.zaehlung.ankerA, 1);
  assert.equal(ber.zaehlung.ankerB, 1);
  assert.ok(Object.prototype.hasOwnProperty.call(ber, 'ankerA') && Object.prototype.hasOwnProperty.call(ber, 'ankerB'),
    'zwei getrennte Listen — VMRK steht in beiden, und man sieht welcher Anker was sah');
  assert.equal(ber.ankerA.klassen[0].beispiele[0].ticker, 'VMRK');
  assert.ok(ber.ankerB.klassen[0].beispiele[0].beine.some((x) => x.ticker === 'VMRK'));
});

test('M9: jede Meldung ist allein nachrechenbar — Anker, Wert, Ticker, Name, Fingerabdruck, Herkunft', () => {
  const a = tripwireAnkerA([zeile('VMRK', 'Vivmark Residential', { shares: 398834711, jahresAktien: 142826382, nameSource: 'longName', fp: FP_AVB })]);
  const m = a.treffer[0];
  for (const feld of ['anker', 'wert', 'ticker', 'name', 'nameSource', 'schluessel', 'fingerabdruck', 'shares', 'jahresAktien']) {
    assert.ok(m[feld] !== undefined, `Feld ${feld} fehlt in der A-Meldung`);
  }
  assert.equal(m.gegenstueck, null, 'A ist ein Einzeilen-Anker — das Partner-Bein ist ausdruecklich null, nicht erfunden');
  assert.ok(m.gegenstueckGrund, 'und der Grund steht dabei, statt dass ein Leser raten muss');
  // Der Wert ist wirklich nachrechenbar: shares / jahresAktien.
  assert.ok(Math.abs(m.wert - m.shares / m.jahresAktien) < 1e-12);

  const b = tripwireAnkerB([zeile('AVB', 'AvalonBay Communities Inc', { fp: FP_AVB, nameSource: 'longName' }), zeile('VMRK', 'Vivmark Residential', { fp: FP_AVB, nameSource: 'watchlist' })]);
  const k = b.treffer[0];
  assert.equal(k.fingerabdruck, FP_AVB, 'der Fingerabdruck der Klasse steht da — seine Gleichheit IST der Anker');
  for (const bein of k.beine) {
    for (const feld of ['ticker', 'name', 'nameSource', 'schluessel']) assert.ok(bein[feld] !== undefined, `Feld ${feld} fehlt am Bein`);
  }
  assert.deepEqual(k.beine.map((x) => x.nameSource), ['longName', 'watchlist'], 'die Herkunft BEIDER Namen steht da');
});

test('M9: die Herkunft ist NIE undefined — sonst verschluckt JSON.stringify den Schluessel', () => {
  // Reproduziert: mit dem Rohwert fiel `nameSource` aus dem committeten Bericht heraus, sobald
  // eine Zeile das Feld (noch) nicht traegt — und "Herkunft unbekannt" war von "Feld vergessen"
  // nicht mehr zu unterscheiden. Der Bericht benutzt deshalb dasselbe Bucket-Vokabular wie M1.
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AAA.json'), JSON.stringify({ meta: { name: 'Alpha AG' }, annual: {} }));
  const { zeilen } = tripwireLesen(dir);
  assert.equal(zeilen[0].nameSource, 'fehlt');
  assert.ok(JSON.stringify(zeilen[0]).includes('"nameSource"'), 'der Schluessel ueberlebt die Serialisierung');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── 4b. DIE DROSSELUNG (Urteil §8 Kipp-Bedingung G4-I, ENTSCHIED 129) ───────────────────
// Gedrosselt wird die MELDEFORM, nie die Erkennung. Die drei Bruchproben des Auftrags:
// (1) Flut EINER Klasse bleibt beschraenkt und zaehlt richtig, (2) eine Klasse mit einem
// einzigen Treffer wird trotzdem gedruckt, (3) absichtlich gebrochene Drosselung wird rot.

/** Zeile mit vorgegebenem Verhaeltnis shares/jahresAktien — am OBJEKT, kein Regel-Nachbau. */
const verhaeltnis = (t, v) => zeile(t, 'Firma ' + t + ' Inc', { shares: v * 1e6, jahresAktien: 1e6 });

test('DROSSELUNG-ANWESENHEIT: eine Flut EINER Klasse bleibt beschraenkt — die Zahl bleibt voll', () => {
  // Der gemessene Live-Fall in klein: 5.000 Zeilen derselben Ursache. Vor der Drosselung
  // besetzte genau so eine Klasse das ganze Anzeigefenster.
  const flut = [];
  for (let i = 0; i < 5000; i++) flut.push(verhaeltnis('T' + i, 1000));
  const a = tripwireAnkerA(flut);
  const ber = tripwireBericht(a, { treffer: [] }, { stand: '2026-08-30', gelesen: flut.length, unlesbar: 0, messebene: 'x' });
  assert.equal(ber.zaehlung.ankerA, 5000, 'die ZAEHLUNG bleibt vollstaendig — gedrosselt ist die Anzeige');
  assert.equal(ber.ankerA.klassen.length, 1, 'eine Ursache, eine Zeile');
  assert.equal(ber.ankerA.klassen[0].gemeldet, 5000, 'und die Zeile traegt die volle Zahl');
  assert.equal(ber.ankerA.klassen[0].beispiele.length, TRIPWIRE_KLASSEN_BEISPIELE, 'die Beispiele sind gekappt');
  assert.equal(ber.ankerA.klassen[0].gelistet, TRIPWIRE_KLASSEN_BEISPIELE, 'und die Kappung steht im Bericht');
  // DIE EIGENTLICHE ZUSAGE: der Bericht waechst mit der Zahl der KLASSEN, nicht der Meldungen.
  const gelistet = ber.ankerA.klassen.reduce((s, k) => s + k.beispiele.length, 0);
  assert.ok(gelistet <= ber.ankerA.klassen.length * TRIPWIRE_KLASSEN_BEISPIELE,
    `der Bericht ist beschraenkt: ${gelistet} gelistete Zeilen bei 5.000 Meldungen`);
  assert.ok(gelistet < 50, 'und zwar wirklich beschraenkt, nicht nur formal');
});

test('DROSSELUNG: KEINE Klasse faellt weg — eine Klasse mit EINEM Treffer wird gedruckt', () => {
  // Die Fehlerrichtung, die eine Drosselung teuer macht: eine Klasse verschwindet ganz.
  // Genau das tat die alte Kappung am Bestand vom 30.08. — ihr Extremwert-Fenster liess VIER
  // der neun Klassen mit NULL Zeilen zurueck, darunter die beiden groessten (1.016 und 308
  // Meldungen, zusammen 94 % aller Meldungen).
  const bestand = [];
  for (let i = 0; i < 5000; i++) bestand.push(verhaeltnis('T' + i, 1000));
  bestand.push(verhaeltnis('EINZELFALL', 0.000001));
  const a = tripwireAnkerA(bestand);
  const ber = tripwireBericht(a, { treffer: [] }, { stand: '2026-08-30', gelesen: bestand.length, unlesbar: 0, messebene: 'x' });
  assert.equal(ber.zaehlung.ankerA, 5001);
  const einzel = ber.ankerA.klassen.find((k) => k.gemeldet === 1);
  assert.ok(einzel, 'die Ein-Treffer-Klasse hat ihre eigene Zeile');
  assert.equal(einzel.beispiele[0].ticker, 'EINZELFALL', 'und sie NENNT ihren einen Fall');
  assert.equal(ber.ankerA.klassen.length, 2, 'zwei Ursachen, zwei Zeilen');
});

test('DROSSELUNG-ABWESENHEIT: ohne Flut aendert die Drosselung NICHTS', () => {
  // Ohne diese Richtung waere die Wache oben mit einer Drosselung gruen, die immer kappt.
  const a = tripwireAnkerA([verhaeltnis('AAA', 3), verhaeltnis('BBB', 0.5)]);
  const ber = tripwireBericht(a, { treffer: [] }, { stand: '2026-08-30', gelesen: 2, unlesbar: 0, messebene: 'x' });
  const gelistet = ber.ankerA.klassen.reduce((s, k) => s + k.beispiele.length, 0);
  assert.equal(gelistet, 2, 'beide Meldungen stehen vollstaendig da');
  for (const k of ber.ankerA.klassen) assert.equal(k.gelistet, k.gemeldet, 'nichts gekappt');
});

test('DROSSELUNG: der Klassenschluessel ist der GEMESSENE WERT, keine benannte Ursache', () => {
  // Der Schluessel darf nichts hineindeuten — eine benannte Ursache waere neue Semantik und
  // damit Methodik. Geprueft am Verhalten: gleiche Groessenordnung -> gleiche Klasse,
  // verschiedene -> verschiedene.
  const k = (v) => tripwireKlassenSchluessel({ anker: 'A', wert: v });
  assert.equal(k(1000), k(1200), 'gleiche Zehnerpotenz, gleiche Klasse');
  assert.notEqual(k(1000), k(0.001), 'entgegengesetzte Richtung, andere Klasse');
  assert.notEqual(k(0.001), k(0.01), 'benachbarte Potenzen bleiben getrennt');
  assert.equal(tripwireKlassenSchluessel({ anker: 'B', wert: 3 }), '3 Emittentengruppen');
  // Ein nicht rechenbarer Wert verschwindet nicht still in `1eNaN`.
  assert.match(tripwireKlassenSchluessel({ anker: 'A', wert: 0 }), /nicht rechenbar/);
});

test('DROSSELUNG: die M12-Ausnahmen werden GENANNT, nicht nur gezaehlt', () => {
  // Eine Rechtsform-Regex, deren Treffer niemand sieht, ist von einer zu weit gefassten Regel
  // nicht zu unterscheiden. Vorher stand im Bericht nur die Zahl.
  const a = tripwireAnkerA([
    zeile('MRK.DE', 'Merck KGaA', { shares: 129242252, jahresAktien: 434777878 }),
    zeile('IEP', 'Icahn Enterprises L.P.', { shares: 1265, jahresAktien: 1000 }),
  ]);
  const ber = tripwireBericht(a, { treffer: [] }, { stand: '2026-08-30', gelesen: 2, unlesbar: 0, messebene: 'x' });
  assert.equal(ber.zaehlung.ankerA, 0, 'beide sind KEIN Befund');
  assert.equal(ber.ankerA.ausgenommen.gemeldet, 2);
  const genannt = ber.ankerA.ausgenommen.klassen[0].beispiele.map((x) => x.ticker).sort();
  assert.deepEqual(genannt, ['IEP', 'MRK.DE'], 'die ausgenommenen Zeilen stehen namentlich da');
  // Und sie stehen NICHT in der Meldungs-Liste: eine Nicht-Meldung darf nie wie eine aussehen.
  assert.deepEqual(ber.ankerA.klassen, []);
});

test('KALIBRIERUNG: die drei Belegfaelle bleiben EINZELN sichtbar', () => {
  // VMRK feuert, MRK.DE ist ausgenommen, MRK.SW (Merck & Co., 0,984 — dieselbe Namenswurzel,
  // aber keine KGaA) bleibt still. Der dritte Fall pinnt, dass die M12-Ausnahme NICHT ueber
  // den Namen "Merck" greift, sondern ueber die Rechtsform: sonst waere jede Merck-Zeile
  // stumm, und die Ausnahme haette sich in eine Handliste zurueckverwandelt.
  const a = tripwireAnkerA([
    zeile('VMRK', 'Vivmark Residential', { shares: 398834711, jahresAktien: 142826382 }),
    zeile('MRK.DE', 'Merck KGaA', { shares: 129242252, jahresAktien: 434777878 }),
    zeile('MRK.SW', 'Merck & Co., Inc.', { shares: 2467171638, jahresAktien: 2507000000 }),
  ]);
  const ber = tripwireBericht(a, { treffer: [] }, { stand: '2026-08-30', gelesen: 3, unlesbar: 0, messebene: 'x' });
  const gemeldet = ber.ankerA.klassen.flatMap((k) => k.beispiele).map((x) => x.ticker);
  assert.deepEqual(gemeldet, ['VMRK'], 'VMRK feuert und steht namentlich im Bericht');
  assert.deepEqual(ber.ankerA.ausgenommen.klassen[0].beispiele.map((x) => x.ticker), ['MRK.DE'],
    'MRK.DE ist ausgenommen und steht namentlich im Ausnahme-Block');
  assert.equal(ber.zaehlung.ankerA_ohneBasis, 0, 'MRK.SW ist still, weil sauber — nicht weil unrechenbar');
});

test('M16: die Abgrenzungsformel steht woertlich im Kopf des Bausteins UND im Bericht', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8');
  assert.ok(quelle.includes('Erkennung und Meldung sind erlaubt; jede Verschmelzungs-Entscheidung auf Basis dieser'),
    'der Satz steht im Kopf des Tripwire-Bausteins');
  const ber = tripwireBericht({ treffer: [], ausgenommen: 0, ohneBasis: 0 }, { treffer: [] }, { stand: 'x', gelesen: 0, unlesbar: 0, messebene: 'x' });
  const doku = ber._doku.join('\n');
  assert.ok(doku.includes('Erkennung und Meldung sind erlaubt'), 'und im Bericht selbst');
  assert.ok(/KEINE MELDUNG HIER IST JE ALLEIN BELEG/.test(doku), 'M18 steht im Bericht');
  assert.ok(/MELDUNG, KEIN BELEG \(M13\)|beweist NICHTS/.test(doku + JSON.stringify(ber)), 'M13 steht im Bericht');
});

// ─── 5. M15: die F-16-STOPP-Klausel ─────────────────────────────────────────────────────

test('M15: der Anker-Pfad kennt weder `exchanges[]` noch eine Waehrungs-Umrechnung', () => {
  // Woertlicher Beweis der Auflage. Die Reihen-Kanonisierung laeuft ueber `milanFingerabdruck`
  // (ratifizierte A7-FX-Ruecknahme, Milan-Urteil) — Wiederverwendung einer bestehenden Regel,
  // keine neue. Was hier NICHT stehen darf, ist eine eigene Rate, ein Waehrungspaar oder eine
  // Boersen-Identitaet je Firma.
  const quelle = fs.readFileSync(SKRIPT, 'utf8');
  const block = quelle.slice(quelle.indexOf('const TRIPWIRE_A_BAND'), quelle.indexOf('const tripwireStandardpfad'));
  assert.ok(block.length > 500, 'Vorbedingung: der Tripwire-Block wurde gefunden');
  assert.ok(!/exchanges\s*\[/.test(block), 'kein exchanges[] im Anker-Pfad');
  assert.ok(!/fxRate(?!Applied)|wechselkurs|currencyPair|umrechn/i.test(block.replace(/meta\.fxRateApplied/g, '')),
    'keine eigene Waehrungslogik im Anker-Pfad');
});

// ─── 6. M8: die Bauform am LAUFENDEN Skript ─────────────────────────────────────────────

/** Ein vollstaendiger Vorstufen-Lauf auf einer Fixture. Gemessen wird das ECHTE Skript, nicht
 *  eine Funktion daraus — die Auflagen "Exit 0", "keine Zeile faellt", "fail-open" sind
 *  Eigenschaften des LAUFS.
 *
 *  DAS KONTAMINIERTE BEIN HEISST BEWUSST NICHT `VMRK`: der echte VMRK steht in
 *  data-health/quarantine.json und erreicht das Ziel gar nicht mehr. Ein Fixture-Lauf mit
 *  diesem Ticker haette still 0 Meldungen ergeben, und die Wache waere aus dem falschen Grund
 *  gruen gewesen. Die ZAHLEN sind die echten (Faktor 2,79), der Ticker ist frei. */
const FIXTURE_BEINE = ['AVB', 'ZZMK', 'MRK.DE'];
function laufe(extra = []) {
  const root = tmp();
  const eingang = path.join(root, 'eingang');
  const ziel = path.join(root, 'ziel');
  fs.mkdirSync(eingang, { recursive: true });
  const schreib = (t, o) => fs.writeFileSync(path.join(eingang, t + '.json'), JSON.stringify(o));
  const rev = [{ value: 3040725000 }, { value: 2913757000 }, { value: 2767909000 }, { value: 2593446000 }];
  schreib('AVB', { meta: { ticker: 'AVB', name: 'AvalonBay Communities Inc', sharesOutstanding: 142797963, fxRateApplied: 1 }, annual: { annualRev: rev, annualShares: [142826382] }, marketCap: { value: 3e10 } });
  schreib('ZZMK', { meta: { ticker: 'ZZMK', name: 'Vivmark Residential', sharesOutstanding: 398834711, fxRateApplied: 1 }, annual: { annualRev: rev, annualShares: [142826382] }, marketCap: { value: 1e9 } });
  schreib('MRK.DE', { meta: { ticker: 'MRK.DE', name: 'Merck KGaA', sharesOutstanding: 129242252, fxRateApplied: 1 }, annual: { annualRev: [{ value: 21102000000 }], annualShares: [434777878] }, marketCap: { value: 2e10 } });
  fs.writeFileSync(path.join(root, 'wl.json'), JSON.stringify({ stocks: FIXTURE_BEINE.map((t) => ({ ticker: t })) }));
  const r = spawnSync(process.execPath, [SKRIPT, '--eingang', eingang, '--ziel', ziel, '--watchlist', path.join(root, 'wl.json'),
    '--heute', '2026-08-30T00:00:00Z', ...extra], { encoding: 'utf8' });
  return { root, ziel, r, ausgabe: (r.stdout || '') + (r.stderr || '') };
}

test('M8: der Tripwire meldet, und der Lauf bleibt Exit 0', () => {
  const { root, ausgabe, r } = laufe();
  assert.equal(r.status, 0, 'keine Faerbung, kein Abbruch');
  assert.match(ausgabe, /\[m10-tripwire\] Anker A .*: 1 Meldungen, 1 Komplementaer/,
    'A meldet VMRK und nimmt Merck KGaA aus');
  assert.match(ausgabe, /\[m10-tripwire\] Anker B .*: 1 Klassen/, 'B meldet die AVB/VMRK-Klasse');
  assert.match(ausgabe, /Erkennung und Meldung sind erlaubt/, 'M16 steht im Lauf-Log');
  fs.rmSync(root, { recursive: true, force: true });
});

test('M8: KEINE Zeile wird durch den Tripwire angefasst (Byte-Vergleich)', () => {
  // Der teuerste denkbare Fehler dieses Bausteins waere, dass er doch schreibt. Verglichen
  // werden die Bytes der behandelten Dateien gegen den Eingang, der laut F-12 unangetastet
  // bleibt — die einzige Referenz, die es hier gibt.
  const { root, ziel, ausgabe } = laufe();
  for (const t of FIXTURE_BEINE) {
    const vorher = fs.readFileSync(path.join(root, 'eingang', t + '.json'));
    const nachher = fs.readFileSync(path.join(ziel, t + '.json'));
    assert.deepEqual(nachher, vorher, `${t} wurde veraendert — der Tripwire darf NICHTS schreiben`);
  }
  assert.match(ausgabe, /\[m10-tripwire\]/, 'Vorbedingung: der Tripwire ist ueberhaupt gelaufen');
  fs.rmSync(root, { recursive: true, force: true });
});

test('M8 FAIL-OPEN: ein Wurf im Baustein laesst den Lauf bei Exit 0 — und wird SICHTBAR', () => {
  // Wurf-Fixture: der Berichtspfad zeigt auf eine DATEI statt in ein Verzeichnis, das Schreiben
  // wirft also. Erwartet: Exit 0 UND eine Warnzeile. Eine still ausfallende Lampe ist keine Lampe.
  const sack = tmp();
  const blocker = path.join(sack, 'blocker');
  fs.writeFileSync(blocker, 'ich bin eine Datei, kein Verzeichnis');
  const { root, r, ausgabe } = laufe(['--tripwire-bericht', path.join(blocker, 'bericht.json')]);
  assert.equal(r.status, 0, 'ein Wurf in der Lampe darf die Tagesfrische von 15.000 Zeilen nicht kosten');
  assert.match(ausgabe, /::warning::M10-Tripwire — Bericht nicht geschrieben/, 'die Degradation nennt sich selbst');
  assert.match(ausgabe, /\[m10-tripwire\] Anker A/, 'die Zahlen stehen trotzdem im Log');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(sack, { recursive: true, force: true });
});

test('DROSSELUNG (am LAUF): die Klassen-Aufschluesselung steht im Lauf-Log', () => {
  // Der Bericht ist committet, das Log ist der Ort, an dem die Lampe wirklich gelesen wird.
  // Die Wache oben misst die Funktion; DIESE misst die Aufrufstelle.
  const { root, ausgabe } = laufe();
  assert.match(ausgabe, /\[m10-tripwire\] {3}A · Groessenordnung 1e[+-]?\d+: 1 Meldungen — Beispiele \(1\): ZZMK=/,
    'die A-Klassenzeile mit voller Zahl und Beispiel');
  assert.match(ausgabe, /\[m10-tripwire\] {3}A · M12-Ausnahme .*: 1 ausgenommen — Beispiele \(1\): MRK\.DE=/,
    'die M12-Ausnahme wird im Log GENANNT, nicht nur gezaehlt');
  assert.match(ausgabe, /\[m10-tripwire\] {3}B · 2 Emittentengruppen: 1 Meldungen/, 'die B-Klassenzeile');
  fs.rmSync(root, { recursive: true, force: true });
});

test('MESSEBENE: der Tripwire sieht die Divergenz, die die Vorstufe gleich HEILT', () => {
  // DAS ist der Grund, warum P2 gewaehlt wurde und nicht P1 (Urteil §3.2): ein wirksamer
  // Eingriff loescht seine eigene Klasse aus der Spur. `ANL.DE` ("ANALOG DEVICES INC.DL-166")
  // und `ADI` haben VOR der T179-Nennwert-Stufe zwei verschiedene issuerKeyLoose und danach
  // einen. Wanderte der Lesedurchgang hinter die Stufen, meldete B hier NICHTS — und die Wache
  // waere gruen aus genau dem Grund, den das Urteil als unzulaessig verworfen hat.
  const root = tmp();
  const eingang = path.join(root, 'eingang');
  const ziel = path.join(root, 'ziel');
  fs.mkdirSync(eingang, { recursive: true });
  const rev = [{ value: 9000000000 }, { value: 8000000000 }, { value: 7000000000 }, { value: 6000000000 }];
  const schreib = (t, n) => fs.writeFileSync(path.join(eingang, t + '.json'), JSON.stringify({
    meta: { ticker: t, name: n, sharesOutstanding: 1e6, fxRateApplied: 1 },
    annual: { annualRev: rev, annualShares: [1e6] }, marketCap: { value: 1e10 },
  }));
  schreib('ADI', 'Analog Devices Inc');
  schreib('ANL.DE', 'ANALOG DEVICES INC.DL-166');
  fs.writeFileSync(path.join(root, 'wl.json'), JSON.stringify({ stocks: [{ ticker: 'ADI' }, { ticker: 'ANL.DE' }] }));
  const r = spawnSync(process.execPath, [SKRIPT, '--eingang', eingang, '--ziel', ziel,
    '--watchlist', path.join(root, 'wl.json'), '--heute', '2026-08-30T00:00:00Z'], { encoding: 'utf8' });
  const ausgabe = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0);
  // Vorbedingung: die Vorstufe hat wirklich geheilt — sonst pruefte der Test nichts.
  assert.match(ausgabe, /\[t179-nennwert\] 1 von 2 Namen um das XETRA-Nennwert-Anhaengsel gekuerzt/);
  assert.match(ausgabe, /\[m10-tripwire\] Anker B .*: 1 Klassen/,
    'der Tripwire hat die Divergenz VOR der Heilung gesehen');
  const b = JSON.parse(fs.readFileSync(tripwireStandardpfad(ziel), 'utf8'));
  assert.deepEqual(b.ankerB.klassen[0].beispiele[0].beine.map((x) => x.schluessel).sort(),
    ['analogdevicesinc', 'analogdevicesincdl166'], 'zwei Schluessel — der Zustand VOR der Stufe');
  fs.rmSync(root, { recursive: true, force: true });
});

test('REVIEW-HAERTUNG: ein unlesbares SIEGER-Bein zaehlt als (unlesbar), nicht als fehlend', () => {
  // Review-Fund 30.08. (MEDIUM): das Nachlesen der Quell-Herkunft (M5) verschluckte jeden
  // Wurf und lieferte `undefined` — gebucht als `fehlt`, also derselbe Bucket wie "die Zeile
  // trug nie eine Herkunft". Ein systemischer Lesefehler war damit von einem Tag ohne
  // watchlist-benannte Sieger nicht zu unterscheiden.
  //
  // Gefahren wird die U2-Strecke, weil sie ohne die eingefrorene Milan-Kandidatenliste
  // auskommt: ein `.BO`/`.NS`-Zwillingspaar, dessen SIEGER-Datei zwischen Schreiben und
  // Nachlesen unlesbar wird. Die Umbenennung selbst passiert trotzdem — das ist die Zusage.
  const root = tmp();
  const eingang = path.join(root, 'eingang');
  const ziel = path.join(root, 'ziel');
  fs.mkdirSync(eingang, { recursive: true });
  const schreib = (t, n) => fs.writeFileSync(path.join(eingang, t + '.json'), JSON.stringify({
    meta: { ticker: t, name: n, nameSource: 'watchlist', sharesOutstanding: 1e6, fxRateApplied: 1 },
    annual: { annualShares: [1e6] }, marketCap: { value: 1e9 },
  }));
  schreib('KRN.BO', 'KRN Heat Exchanger and Refrigeration Limited');
  schreib('KRN.NS', 'KRN HEAT EXCHANGE N REF L');
  fs.writeFileSync(path.join(root, 'wl.json'), JSON.stringify({ stocks: [{ ticker: 'KRN.BO' }, { ticker: 'KRN.NS' }] }));
  const r = spawnSync(process.execPath, [SKRIPT, '--eingang', eingang, '--ziel', ziel,
    '--watchlist', path.join(root, 'wl.json'), '--heute', '2026-08-30T00:00:00Z'], { encoding: 'utf8' });
  const ausgabe = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0);
  assert.match(ausgabe, /je Herkunft des Quell-Beins: \{"watchlist":1\}/,
    'ANWESENHEIT: die Herkunft des Siegers wird gelesen und gezaehlt');
  assert.match(ausgabe, /watchlist-benannte Quell-Beine: 1 — KRN\.NS<-KRN\.BO/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('REVIEW-HAERTUNG: NICHT LESBAR ist nicht KEINE HERKUNFT (Sieger-Nachlese)', () => {
  // Review-Fund 30.08. (MEDIUM): das Nachlesen der Quell-Herkunft verschluckte jeden Wurf und
  // lieferte `undefined` — gebucht als `fehlt`, also derselbe Bucket wie "die Zeile trug nie
  // eine Herkunft". Ein systemischer Lesefehler war damit von einem Tag ohne watchlist-
  // benannte Sieger nicht zu unterscheiden.
  //
  // Gemessen an der Funktion selbst, weil der U3-Pfad im Lauf die eingefrorene
  // Milan-Kandidatenliste braucht; die Verdrahtung deckt der End-to-End-Test darunter ab.
  const { siegerHerkunftNachlesen } = require('../scripts/filter-snapshot-merge.js');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'GUT.json'), JSON.stringify({ meta: { name: 'Gut AG', nameSource: 'watchlist' } }));
  fs.writeFileSync(path.join(dir, 'KAPUTT.json'), '{ das ist kein json');
  fs.writeFileSync(path.join(dir, 'OHNE.json'), JSON.stringify({ meta: { name: 'Ohne AG' } }));

  // ANWESENHEIT: eine lesbare Datei liefert ihre echte Herkunft.
  assert.deepEqual(siegerHerkunftNachlesen(dir, 'GUT'), { herkunft: 'watchlist', unlesbar: false });
  // Die drei Lagen muessen DREI verschiedene Buckets ergeben — das ist die ganze Haertung.
  const bucket = (t) => umbenennungsProtokoll([{ verlierer: 'X', sieger: t, quelleHerkunft: siegerHerkunftNachlesen(dir, t).herkunft }]).jeHerkunft;
  assert.deepEqual(bucket('GUT'), { watchlist: 1 });
  assert.deepEqual(bucket('OHNE'), { fehlt: 1 }, 'gelesen, aber ohne Herkunft: FEHLT');
  assert.deepEqual(bucket('KAPUTT'), { '(unlesbar)': 1 }, 'gar nicht lesbar: eigener Bucket, NICHT fehlt');
  assert.equal(siegerHerkunftNachlesen(dir, 'KAPUTT').unlesbar, true);
  assert.ok(siegerHerkunftNachlesen(dir, 'KAPUTT').grund, 'und der Grund steht dabei, statt verschluckt zu werden');
  // ABWESENHEIT: eine gar nicht vorhandene Datei ist ebenfalls "nicht lesbar", nicht "fehlt".
  assert.equal(siegerHerkunftNachlesen(dir, 'GIBTSNICHT').herkunft, '(unlesbar)');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REVIEW-HAERTUNG: ein M1-Ausfall reisst das M5-Protokoll NICHT mit', () => {
  // Review-Fund 30.08. (MEDIUM): beide lagen in EINEM try. Ein Wurf auf der M5-Seite haette
  // die M1-Tageszeile still verschluckt — und M1 ist die Auflage MIT FRIST (20.09.), deren
  // ganzer Zweck es ist, dass Beweise nicht still verlorengehen.
  //
  // GEMESSEN, nicht am Quelltext geprueft: der Zaehler-Pfad wird zum Scheitern gebracht (der
  // Reihen-Pfad zeigt auf eine DATEI statt in ein Verzeichnis), und es wird nachgesehen, ob
  // das M5-Protokoll trotzdem vollstaendig im Log steht. Waeren die beiden noch gekoppelt,
  // haette der erste Wurf beide Ausgaben genommen.
  const sack = tmp();
  const blocker = path.join(sack, 'blocker');
  fs.writeFileSync(blocker, 'ich bin eine Datei, kein Verzeichnis');
  const { root, r, ausgabe } = laufe(['--namensherkunft', path.join(blocker, 'reihe.json')]);
  assert.equal(r.status, 0, 'reine Messung — der Lauf stirbt nicht daran');
  assert.match(ausgabe, /::warning::M10-Herkunftszaehler — Messung ausgefallen/,
    'der M1-Ausfall meldet sich, und zwar unter SEINEM Namen');
  assert.match(ausgabe, /\[m10-umbenennungs-protokoll\] \d+ Umbenennungen in der Vorstufe/,
    'das M5-Protokoll ist trotzdem vollstaendig da');
  assert.match(ausgabe, /\[m10-umbenennungs-protokoll\] watchlist-benannte Quell-Beine:/);
  assert.doesNotMatch(ausgabe, /::warning::M10-Protokoll \(M5\)/, 'und M5 hat NICHT mitgemeldet');
  // Gegenrichtung, soweit von aussen erreichbar: die M5-Degradationsmeldung sagt ausdruecklich
  // zu, dass sie M1 nicht mitreisst. Der Satz ist die Zusage, auf die sich ein Leser des Logs
  // verlaesst, wenn der umgekehrte Fall eintritt.
  assert.match(fs.readFileSync(SKRIPT, 'utf8'),
    /::warning::M10-Protokoll \(M5\) — Interims-Protokoll ausgefallen[^`]*Der Herkunfts-Zaehler \(M1\) laeuft davon UNBERUEHRT weiter/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(sack, { recursive: true, force: true });
});

test('REVIEW-HAERTUNG: ein AUSGEFALLENER Anker steht als ausgefallen da, nie als 0', () => {
  // Review-Fund 30.08.: der Bericht wurde nur geschrieben, wenn BEIDE Anker durchliefen — ein
  // Wurf in A nahm also auch Bs fertig gerechnete Meldungen aus der committeten Datei, und die
  // fail-open-Zusage "faellt A aus, meldet B trotzdem" galt nur fuers fluechtige Log.
  const b = tripwireAnkerB([zeile('AVB', 'AvalonBay Communities Inc', { fp: FP_AVB }), zeile('VMRK', 'Vivmark Residential', { fp: FP_AVB })]);
  const ber = tripwireBericht(null, b, { stand: '2026-08-30', gelesen: 2, unlesbar: 0, messebene: 'x' });
  assert.equal(ber.ankerA.ausgefallen, true);
  assert.equal(ber.zaehlung.ankerA, null, 'NICHT 0 — "nicht gemessen" darf nie wie "nichts gefunden" aussehen');
  assert.ok(ber.ankerA.grund, 'und der Grund steht dabei');
  assert.equal(ber.ankerB.ausgefallen, false, 'der lebende Anker bleibt vollstaendig im Bericht');
  assert.equal(ber.zaehlung.ankerB, 1);
  assert.equal(ber.ankerB.klassen[0].gemeldet, 1);
  // ABWESENHEIT: laufen beide, ist nichts als ausgefallen markiert.
  const a = tripwireAnkerA([zeile('VMRK', 'Vivmark Residential', { shares: 398834711, jahresAktien: 142826382 })]);
  const beide = tripwireBericht(a, b, { stand: '2026-08-30', gelesen: 2, unlesbar: 0, messebene: 'x' });
  assert.equal(beide.ankerA.ausgefallen, false);
  assert.equal(beide.ankerB.ausgefallen, false);
});

test('REVIEW-HAERTUNG: der Tripwire misst DASSELBE Verzeichnis wie sein Schwester-Zaehler', () => {
  // Review-Fund 30.08. (MEDIUM, reproduziert): `tripwireLesen` las die Uebernahme-Liste dieses
  // Laufs, `namensherkunftLesen` das ganze Verzeichnis. Dieser Schritt raeumt `ziel` nie ab —
  // ein Stand aus einem frueheren Lauf wird weiter GESCORT, waere aber an beiden Ankern
  // vorbeigelaufen. Zwei Messungen desselben Urteils duerfen nicht zwei Populationen meinen.
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'NEU.json'), JSON.stringify({ meta: { name: 'Neu AG', sharesOutstanding: 10, fxRateApplied: 1 }, annual: { annualShares: [1] } }));
  fs.writeFileSync(path.join(dir, 'ALT.json'), JSON.stringify({ meta: { name: 'Alt aus frueherem Lauf AG', sharesOutstanding: 10, fxRateApplied: 1 }, annual: { annualShares: [1] } }));
  const { zeilen } = tripwireLesen(dir);
  assert.deepEqual(zeilen.map((z) => z.ticker).sort(), ['ALT', 'NEU'],
    'die Altlast wird MITGEMESSEN — sie wird ja auch mitgescort');
  const { namensherkunftLesen } = require('../scripts/filter-snapshot-merge.js');
  assert.equal(namensherkunftLesen(dir).zeilen.length, zeilen.length,
    'beide M10-Messungen sehen dieselbe Population');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REVIEW-HAERTUNG (am LAUF): eine Altlast im Ziel wird vom Tripwire MITGEMESSEN', () => {
  // Die Wache darueber misst die Funktion; DIESE misst die Aufrufstelle. Genau dort lag der
  // Fund: `run()` reichte die Uebernahme-Liste dieses Laufs hinein. Eine Datei, die aus einem
  // frueheren Lauf im Ziel liegt, steht in keiner Uebernahme-Liste — wird aber weiter GESCORT.
  // Sie muss also in beiden M10-Messungen auftauchen.
  const root = tmp();
  const eingang = path.join(root, 'eingang');
  const ziel = path.join(root, 'ziel');
  fs.mkdirSync(eingang, { recursive: true });
  fs.mkdirSync(ziel, { recursive: true });
  const daten = (n, shares) => JSON.stringify({
    meta: { ticker: n, name: n + ' AG', sharesOutstanding: shares, fxRateApplied: 1 },
    annual: { annualShares: [1000000] }, marketCap: { value: 1e9 },
  });
  fs.writeFileSync(path.join(eingang, 'NEU.json'), daten('NEU', 1000000));      // sauber, 1,000
  fs.writeFileSync(path.join(ziel, 'ALTLAST.json'), daten('ALTLAST', 9000000)); // 9,0 -> Anker A
  fs.writeFileSync(path.join(root, 'wl.json'), JSON.stringify({ stocks: [{ ticker: 'NEU' }] }));
  const r = spawnSync(process.execPath, [SKRIPT, '--eingang', eingang, '--ziel', ziel,
    '--watchlist', path.join(root, 'wl.json'), '--heute', '2026-08-30T00:00:00Z'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const b = JSON.parse(fs.readFileSync(tripwireStandardpfad(ziel), 'utf8'));
  assert.equal(b.gelesen, 2, 'der Tripwire hat BEIDE Dateien gesehen, nicht nur die uebernommene');
  assert.equal(b.zaehlung.ankerA, 1);
  assert.equal(b.ankerA.klassen[0].beispiele[0].ticker, 'ALTLAST',
    'genau die Altlast, die keine Uebernahme-Liste je genannt haette');
  fs.rmSync(root, { recursive: true, force: true });
});

test('M9: der Bericht wird geschrieben und liegt beim gemessenen Bestand, nicht im Repo', () => {
  const { root, ziel } = laufe();
  const p = tripwireStandardpfad(ziel);
  assert.ok(fs.existsSync(p), 'der Bericht existiert nach dem Lauf');
  assert.ok(!path.resolve(p).startsWith(path.resolve(__dirname, '..')),
    'ein Fixture-Lauf darf NIE in das echte data-health/ schreiben');
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(b.zaehlung.ankerA, 1);
  assert.equal(b.zaehlung.ankerA_ausgenommen, 1);
  assert.equal(b.zaehlung.ankerB, 1);
  assert.equal(b.ankerA.klassen[0].beispiele[0].ticker, 'ZZMK');
  assert.ok(/vor den Umbenennungs-Stufen/.test(b.messebene), 'die Messebene steht im Bericht');
  fs.rmSync(root, { recursive: true, force: true });
});

console.log(`\nm10-tripwire.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
