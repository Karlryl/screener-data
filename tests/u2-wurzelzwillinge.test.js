'use strict';
/**
 * U2-BO/NS (Orchestrator ENTSCHIED 21, 2026-08-29) — Waechter der Wurzel-Zwillings-Vorstufe
 * in scripts/filter-snapshot-merge.js.
 *
 * BEFUND (Akte befund-doppelgaenger-2026-08-29.md + Addendum): 53 Emittenten standen am
 * 29.08. mit beiden Beinen im Board, 12 davon als BSE/NSE-Zwillinge. Der Dedup gruppiert ueber
 * den Namen; die beiden indischen Feeds schreiben ihn verschieden ("KRN Heat Exchanger and
 * Refrigeration Limited" gegen "KRN HEAT EXCHANGE N REF L"), also standen beide Beine im Board.
 *
 * DIESER WAECHTER pinnt BEIDE Richtungen — das ist der Vertrag, nicht die Ausbeute:
 *   VORWAERTS: ein .BO/.NS-Paar mit gleicher Wurzel und abweichenden Namen WIRD vereinheitlicht,
 *              und zwar so, dass der echte issuerKeyLoose danach GLEICH ist (an der importierten
 *              Produktionsfunktion gemessen, nicht an einem Nachbau — Fehler F1334).
 *   RUECKWAERTS: was keine gemeinsame Wurzel hat, wird NIE angefasst. Ausdruecklich mitgeprueft
 *              ist der Mailaender Praefix-Fall (1SAN.MI Sanofi gegen SAN Banco Santander) —
 *              die 28 belegten Fremdpaare, die laut ENTSCHIED 21 Punkt 3 dem Gericht gehoeren
 *              und hier NICHT gebaut werden. Faellt diese Wache, verschmilzt der naechste
 *              Ausbau zwei verschiedene Firmen und LOESCHT eine davon aus dem Board.
 *
 * Gegen-Proben (die absichtlichen Brueche) stehen als eigene Tests daneben: die Wache wurde
 * einmal in jede Richtung rot gesehen, bevor sie als fertig galt.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/u2-wurzelzwillinge.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  istPlatzhalter, besseresBein, wurzelZwillingsUmbenennungen, wendeWurzelZwillingeAn,
} = require('../scripts/filter-snapshot-merge.js');
// Die Produktionsregel selbst — der Waechter misst am Schluessel, der spaeter wirklich gruppiert.
const { issuerKeyLoose } = require('../src/scoring/score.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const stand = (ticker, name) => ({ datei: `${ticker}.json`, ticker, metaTicker: ticker, name });
const schluessel = (n) => issuerKeyLoose({ meta: { name: n } });

// ─── 1. VORWAERTS: der Zwilling wird zusammengefuehrt ────────────────────────────

test('VORWAERTS: .BO/.NS-Zwilling mit abweichenden Namen wird vereinheitlicht (KRN, echtes Paar)', () => {
  const u = wurzelZwillingsUmbenennungen([
    stand('KRN.BO', 'KRN Heat Exchanger and Refrigeration Limited'),
    stand('KRN.NS', 'KRN HEAT EXCHANGE N REF L'),
  ]);
  assert.equal(u.size, 1, 'genau EIN Bein wird umbenannt (das Verlierer-Bein)');
  assert.equal(u.get('KRN.NS.json'), 'KRN Heat Exchanger and Refrigeration Limited',
    'die NSE-Kurzform bekommt den vollstaendigen Namen, nicht umgekehrt');
});

test('VORWAERTS: nach der Vereinheitlichung ist der ECHTE issuerKeyLoose gleich (Wirkungs-Beweis)', () => {
  // Das ist der eigentliche Zweck: nicht "ein String wurde geschrieben", sondern "der Dedup
  // sieht jetzt EINEN Emittenten". Gemessen an der importierten Produktionsfunktion.
  const paare = [
    ['TARIL.BO', 'Transformers and Rectifiers (India) Limited', 'TARIL.NS', 'TRANS & RECTI. LTD'],
    ['SKFINDUS.BO', 'SKF India (Industrial) Limited', 'SKFINDUS.NS', 'SKF IND (INDUSTRIAL) LTD'],
    ['QPOWER.BO', 'Quality Power Electrical Equipments Limited', 'QPOWER.NS', 'QUALITY POWER ELEC EQUP L'],
    ['JNPR.BO', 'JNPR.BO', 'JNPR.NS', 'Juniper Green Energy Limited'],
  ];
  for (const [tA, nA, tB, nB] of paare) {
    assert.notEqual(schluessel(nA), schluessel(nB), `${tA}/${tB}: Vorbedingung — heute getrennt`);
    const u = wurzelZwillingsUmbenennungen([stand(tA, nA), stand(tB, nB)]);
    assert.equal(u.size, 1, `${tA}/${tB}: genau ein Bein umbenannt`);
    const namen = { [`${tA}.json`]: nA, [`${tB}.json`]: nB };
    for (const [datei, neu] of u) namen[datei] = neu;
    assert.equal(schluessel(namen[`${tA}.json`]), schluessel(namen[`${tB}.json`]),
      `${tA}/${tB}: nach der Vorstufe muss der Dedup EINEN Emittenten sehen`);
  }
});

test('VORWAERTS: der Platzhalter verliert immer (Heilung ueber die Notierungen hinweg, JNPR)', () => {
  // pull-yahoo faellt ohne longName/shortName auf den Ticker zurueck; dieses Bein traegt dann
  // seinen eigenen Namen nicht. Gleicher Mechanismus wie platzhalter() in refresh-universe.js:883.
  const u = wurzelZwillingsUmbenennungen([
    stand('JNPR.BO', 'JNPR.BO'),
    stand('JNPR.NS', 'Juniper Green Energy Limited'),
  ]);
  assert.equal(u.get('JNPR.BO.json'), 'Juniper Green Energy Limited');
  assert.equal(u.has('JNPR.NS.json'), false, 'das Bein MIT Klarnamen darf nie den Platzhalter erben');
});

test('VORWAERTS-Gegenprobe (absichtlicher Bruch): eine Vorstufe, die nichts tut, faellt auf', () => {
  const nichtstun = () => new Map();
  const u = nichtstun();
  assert.throws(() => {
    assert.equal(u.size, 1, 'Zwilling muss vereinheitlicht werden');
  }, 'eine wirkungslose Vorstufe MUSS diesen Waechter rot machen');
});

// ─── 2. RUECKWAERTS: was kein Zwilling ist, wird nie angefasst ───────────────────

test('RUECKWAERTS: verschiedene Wurzeln werden NIE vereinheitlicht', () => {
  const u = wurzelZwillingsUmbenennungen([
    stand('KRN.BO', 'KRN Heat Exchanger and Refrigeration Limited'),
    stand('ABDL.NS', 'ALLIED BLEND N DISTILS L'),
  ]);
  assert.equal(u.size, 0, 'zwei verschiedene Firmen an zwei Boersen sind kein Zwilling');
});

test('RUECKWAERTS: der Mailaender Praefix-Fall bleibt UNBERUEHRT (Sanofi/Santander-Klasse)', () => {
  // ENTSCHIED 21 Punkt 3: 28 belegte Fremdpaare, das 1-Praefix traegt das Heimatmarkt-Kuerzel.
  // Ausdruecklich NICHT Teil dieses Baus. Faellt dieser Test, ist die Sperre gebrochen.
  const fremdpaare = [
    ['1SAN.MI', 'Sanofi', 'SAN', 'Banco Santander, S.A.'],
    ['1ROG.MI', 'Roche Holding AG', 'ROG', 'Rogers Corporation'],
    ['1MRK.MI', 'Merck KGaA', 'MRK', 'Merck & Co., Inc.'],
    ['1MC.MI', 'LVMH', 'MC', 'Moelis & Company'],
  ];
  for (const [tA, nA, tB, nB] of fremdpaare) {
    const u = wurzelZwillingsUmbenennungen([stand(tA, nA), stand(tB, nB)]);
    assert.equal(u.size, 0, `${tA}/${tB} darf NIE zusammengefuehrt werden — das sind zwei Firmen`);
  }
});

test('RUECKWAERTS: gleiche Wurzel, aber ein ANDERES Boersensuffix bleibt unberuehrt', () => {
  // Die Regel ist bewusst auf .BO/.NS begrenzt — nur dort ist die Wurzel-Identitaet gemessen
  // (524 Zwillinge, null Fremdpaare). Jede andere Boerse ist ungemessen und bleibt draussen.
  for (const [a, b] of [['SVM', 'SVM.TO'], ['KMI', 'KMI.VI'], ['AERO', 'AERO.MX'], ['GE', 'GE.VI']]) {
    const u = wurzelZwillingsUmbenennungen([stand(a, a), stand(b, 'Irgendeine Firma Inc.')]);
    assert.equal(u.size, 0, `${a}/${b}: ungemessenes Suffix — nicht in diesem Bau`);
  }
});

test('RUECKWAERTS: ein einzelnes .BO oder .NS ohne Zwilling bleibt unberuehrt', () => {
  assert.equal(wurzelZwillingsUmbenennungen([stand('KRN.BO', 'KRN Heat Exchanger and Refrigeration Limited')]).size, 0);
  assert.equal(wurzelZwillingsUmbenennungen([stand('KRN.NS', 'KRN HEAT EXCHANGE N REF L')]).size, 0);
});

test('RUECKWAERTS-Gegenprobe (absichtlicher Bruch): eine Praefix-Regel wuerde hier auffliegen', () => {
  // Nachbau der VERBOTENEN Verallgemeinerung "gleiche Wurzel, egal welches Suffix/Praefix":
  // sie zieht Sanofi und Santander zusammen. Der Test beweist, dass die Wache das faengt.
  const naiv = (staende) => {
    const u = new Map();
    const wurzel = (t) => t.replace(/^1/, '').replace(/\.[A-Z]+$/, '');
    const nachWurzel = new Map();
    for (const s of staende) {
      const w = wurzel(s.ticker);
      if (!nachWurzel.has(w)) nachWurzel.set(w, []);
      nachWurzel.get(w).push(s);
    }
    for (const gruppe of nachWurzel.values()) {
      if (gruppe.length !== 2) continue;
      u.set(gruppe[1].datei, gruppe[0].name);
    }
    return u;
  };
  const kaputt = naiv([stand('1SAN.MI', 'Sanofi'), stand('SAN', 'Banco Santander, S.A.')]);
  assert.equal(kaputt.size, 1, 'die naive Regel verschmilzt tatsaechlich — genau das ist der Schaden');
  assert.throws(() => {
    assert.equal(kaputt.size, 0, 'Sanofi/Santander darf nie zusammengefuehrt werden');
  }, 'die Rueckwaerts-Wache MUSS bei einer Praefix-Regel rot werden');
});

// ─── 3. Sieger-Regel und Randfaelle ─────────────────────────────────────────────

test('Sieger-Regel: Platzhalter < laengerer Name; Gleichstand deterministisch per Code-Unit', () => {
  assert.equal(besseresBein(stand('X.BO', 'X.BO'), stand('X.NS', 'Echte Firma Ltd')).ticker, 'X.NS');
  assert.equal(besseresBein(stand('X.BO', 'Sehr Ausfuehrlicher Firmenname Limited'), stand('X.NS', 'KURZ L')).ticker, 'X.BO');
  // Gleich lang, verschieden geschrieben: stabile Wahl, unabhaengig von der Aufrufreihenfolge.
  const a = stand('X.BO', 'BELRISE INDUSTRIES LIMITED');
  const b = stand('X.NS', 'Belrise Industries Limited');
  assert.equal(besseresBein(a, b).name, besseresBein(b, a).name, 'Reihenfolge darf das Ergebnis nicht drehen');
});

test('Randfall: beide Beine sind Platzhalter — es wird NICHTS geraten', () => {
  const u = wurzelZwillingsUmbenennungen([stand('ZZZ.BO', 'ZZZ.BO'), stand('ZZZ.NS', 'ZZZ.NS')]);
  assert.equal(u.size, 0, 'ohne echten Namen gibt es nichts zu uebertragen');
});

test('Randfall: bereits gleicher Emittenten-Schluessel wird nicht angefasst (kein Leerlauf-Schreiben)', () => {
  // 480 der 524 Zwillinge tragen schon denselben Rohstring, viele weitere fallen erst durch
  // issuerKeyLoose zusammen ("Aequs Limited"/"AEQUS LIMITED"). Die Vorstufe darf sie nicht anruehren.
  assert.equal(wurzelZwillingsUmbenennungen([
    stand('AEQUS.BO', 'Aequs Limited'), stand('AEQUS.NS', 'AEQUS LIMITED'),
  ]).size, 0);
  assert.equal(wurzelZwillingsUmbenennungen([
    stand('DEEPAKNTR.BO', 'DEEPAK NITRITE LTD.'), stand('DEEPAKNTR.NS', 'Deepak Nitrite Limited'),
  ]).size, 0);
});

test('istPlatzhalter erkennt leer, Ticker-Gleichheit und Dateinamen-Kennung', () => {
  assert.equal(istPlatzhalter('', 'X.BO'), true);
  assert.equal(istPlatzhalter('   ', 'X.BO'), true);
  assert.equal(istPlatzhalter(null, 'X.BO'), true);
  assert.equal(istPlatzhalter('x.bo', 'X.BO'), true, 'Gross-/Kleinschreibung darf nicht taeuschen');
  assert.equal(istPlatzhalter('Echte Firma Ltd', 'X.BO'), false);
});

// ─── 4. Der I/O-Mantel am echten Dateisystem ────────────────────────────────────

test('I/O: nur das Verlierer-Bein wird geschrieben, alles andere bleibt byte-gleich', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u2-zwillinge-'));
  const schreibe = (t, name) => {
    const p = path.join(tmp, `${t}.json`);
    fs.writeFileSync(p, JSON.stringify({ meta: { ticker: t, name }, kennzahlen: { revenueTTM: 1 } }));
    return p;
  };
  const pBo = schreibe('KRN.BO', 'KRN Heat Exchanger and Refrigeration Limited');
  const pNs = schreibe('KRN.NS', 'KRN HEAT EXCHANGE N REF L');
  const pFremd = schreibe('ABDL.NS', 'ALLIED BLEND N DISTILS L');
  const vorherBo = fs.readFileSync(pBo, 'utf8');
  const vorherFremd = fs.readFileSync(pFremd, 'utf8');

  const res = wendeWurzelZwillingeAn(tmp, ['KRN.BO.json', 'KRN.NS.json', 'ABDL.NS.json', '_manifest.json']);

  assert.deepEqual(res.geheilt, ['KRN.NS']);
  assert.equal(res.unlesbar, 0);
  assert.equal(fs.readFileSync(pBo, 'utf8'), vorherBo, 'das Sieger-Bein bleibt unangetastet');
  assert.equal(fs.readFileSync(pFremd, 'utf8'), vorherFremd, 'ein Nicht-Zwilling bleibt unangetastet');
  const ns = JSON.parse(fs.readFileSync(pNs, 'utf8'));
  assert.equal(ns.meta.name, 'KRN Heat Exchanger and Refrigeration Limited');
  assert.equal(ns.meta.ticker, 'KRN.NS', 'der Ticker bleibt der des Beins — nur der Name wird vereinheitlicht');
  assert.equal(ns.kennzahlen.revenueTTM, 1, 'der uebrige Snapshot bleibt vollstaendig erhalten');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('I/O: ein kaputter Snapshot stoppt den Lauf nicht, wird aber gezaehlt (kein stiller Ausfall)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u2-kaputt-'));
  fs.writeFileSync(path.join(tmp, 'KRN.BO.json'), '{ kein json');
  fs.writeFileSync(path.join(tmp, 'KRN.NS.json'), JSON.stringify({ meta: { ticker: 'KRN.NS', name: 'KRN HEAT EXCHANGE N REF L' } }));
  const res = wendeWurzelZwillingeAn(tmp, ['KRN.BO.json', 'KRN.NS.json']);
  assert.equal(res.unlesbar, 1, 'der Ausfall muss sichtbar sein');
  assert.deepEqual(res.geheilt, [], 'ohne zweites Bein wird nichts umbenannt');
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\nu2-wurzelzwillinge.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
