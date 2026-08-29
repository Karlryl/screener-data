'use strict';
/**
 * Waechter des Betriebsmodus-Pinnings (W3/T155, Rat 29.08., Weg D).
 *
 * Der produktive Lauf waehlt seinen Modus ueber SCORING_REF_CALIB im versiegelten
 * run-screener.js und hinterlaesst keinen Beleg. scripts/write-excluded-list.js ist
 * der freie Zweitleser: er scort unter der eingecheckten DEKLARATION
 * (configs/scoring-mode.json) und vergleicht die fuenf Lineal-Skalare seines Passes
 * gegen outputs/calibration.json des versiegelten Laufs. Dieser Waechter haengt an
 * der SACHE (Deklaration, Umgebungs-Widerspruch, Skalar-Diskriminator), nicht an
 * Textmustern — er prueft Anwesenheit UND Abwesenheit jeder Regel.
 *
 * Bewusst NICHT in tests/scoring/: dieser Bereich ist versiegelt (Gerichts-Sperre);
 * der Waechter lebt im freien tests/-Glob des CI-Gates (tests/*test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  liesModusDeklaration, pruefeModusUmgebung, vergleicheLinealSkalare, kanonisch, LINEAL_SKALARE,
} = require('../scripts/write-excluded-list.js');

// Realistische Fixture in der Form von outputs/calibration.json (calibration/v4):
// verschachteltes winsorBounds, Arrays, ein Skalar. Die Zusatz-Schluessel unten
// (cohortBases/gDistByCohort/generated_at) stehen fuer die Merge-Feinstruktur, die
// laut Rat-Haertung (4) NICHT verglichen werden darf (nicht bytestabil).
const LINEAL = {
  winsorBounds: { opMargin: [-17.47, 1], qoq: [-0.55, 1.4] },
  growthBounds: [-0.51, 3.38],
  cycleDDThreshold: 0.1132774678039564,
  mcapBounds: [1948677964.8, 4237413367.3, 8991621120, 25200339671.9],
  ipoBounds: [1992, 2000, 2009.8, 2019],
};
const feinstruktur = { generated_at: '2026-08-29T00:00:00Z', schema: 'calibration/v4', cohortBases: { a: 1 }, gDistByCohort: { x: [1, 2] } };

test('eingecheckte Deklaration ist live-lernend (Rat-Haertung 1: Default-Pin)', () => {
  // Der produktive Scoring-Step laeuft ohne SCORING_REF_CALIB. Wer die eingecheckte
  // Datei auf referenz stellt, stellt still die Scores um — das MUSS hier laut werden.
  const d = liesModusDeklaration();
  assert.equal(d.modus, 'live-lernend');
  assert.equal(d.refCalib, null);
});

test('Deklarations-Leser wirft bei fehlender/kaputter/unbekannter Deklaration (fail-closed)', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-mode-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const f = (inhalt) => { const p = path.join(tmp, 'mode.json'); fs.writeFileSync(p, inhalt); return p; };
  assert.throws(() => liesModusDeklaration(path.join(tmp, 'fehlt.json')), /fehlt\/unlesbar/);
  assert.throws(() => liesModusDeklaration(f('kein json')), /fehlt\/unlesbar/);
  assert.throws(() => liesModusDeklaration(f('{"schema":"anders/v9","modus":"live-lernend"}')), /schema/);
  assert.throws(() => liesModusDeklaration(f('{"schema":"scoring-mode/v1","modus":"turbo"}')), /unbekannter modus/);
  assert.throws(() => liesModusDeklaration(f('{"schema":"scoring-mode/v1","modus":"referenz"}')), /braucht refCalib/);
  // Anwesenheit der Gegenrichtung: gueltiges referenz-Paar kommt durch.
  const d = liesModusDeklaration(f('{"schema":"scoring-mode/v1","modus":"referenz","refCalib":"x/lineal.json"}'));
  assert.deepEqual(d, { modus: 'referenz', refCalib: 'x/lineal.json' });
});

test('Umgebungs-Vorstufe: live-lernend + gesetztes SCORING_REF_CALIB ist ein Verstoss', () => {
  const live = { modus: 'live-lernend', refCalib: null };
  assert.deepEqual(pruefeModusUmgebung(live, undefined), [], 'live ohne env ist der Regelfall');
  const v = pruefeModusUmgebung(live, 'irgendwo/lineal.json');
  assert.equal(v.length, 1);
  assert.match(v[0], /live-lernend/);
  assert.match(v[0], /SCORING_REF_CALIB/);
});

test('Umgebungs-Vorstufe: referenz duldet nur DASSELBE Lineal in der Umgebung', () => {
  const ref = { modus: 'referenz', refCalib: 'protocol/x/lineal.json' };
  assert.deepEqual(pruefeModusUmgebung(ref, undefined), [], 'env darf fehlen — Deklaration traegt');
  assert.deepEqual(pruefeModusUmgebung(ref, 'protocol/x/lineal.json'), [], 'gleicher Pfad ist kein Widerspruch');
  const v = pruefeModusUmgebung(ref, 'protocol/ANDERS/lineal.json');
  assert.equal(v.length, 1);
  assert.match(v[0], /referenz/);
});

test('Skalar-Vergleich: identische Werte sind sauber — unabhaengig von Schluessel-Reihenfolge und Feinstruktur', () => {
  // winsorBounds mit VERTAUSCHTER Schluessel-Reihenfolge + beidseitig verschiedener
  // Feinstruktur: genau das darf den Vergleich nicht bewegen (Rat-Haertung 4).
  const eigen = { ...LINEAL, winsorBounds: { qoq: [-0.55, 1.4], opMargin: [-17.47, 1] }, cohortBases: { b: 2 } };
  const versiegelt = { ...feinstruktur, ...LINEAL };
  assert.deepEqual(vergleicheLinealSkalare(eigen, versiegelt), []);
});

test('Skalar-Vergleich: ein verdrehter Wert wird beim Namen genannt (Modus-Diskriminator)', () => {
  const versiegelt = { ...LINEAL, cycleDDThreshold: LINEAL.cycleDDThreshold + 1e-9 };
  const v = vergleicheLinealSkalare(LINEAL, versiegelt);
  assert.equal(v.length, 1);
  assert.match(v[0], /^cycleDDThreshold: /);
  // und die verschachtelte Richtung:
  const v2 = vergleicheLinealSkalare({ ...LINEAL, winsorBounds: { opMargin: [-17.47, 1], qoq: [-0.55, 999] } }, LINEAL);
  assert.equal(v2.length, 1);
  assert.match(v2[0], /^winsorBounds: /);
});

test('Skalar-Vergleich: ein FEHLENDER Skalar ist ein Verstoss, kein Skip (Rat-Haertung 2)', () => {
  // Ein Emissions-Refactor, der einen der fuenf Schluessel umbenennt, muss hier LAUT
  // brechen — sonst pruefte der Waechter still nichts mehr. Die Liste kommt aus dem
  // MODUL, nicht als Abschrift: waechst sie dort, waechst dieser Test mit.
  assert.equal(LINEAL_SKALARE.length, 5, 'fuenf Lineal-Skalare laut Rat-Beschluss');
  for (const k of LINEAL_SKALARE) {
    const ohne = { ...LINEAL };
    delete ohne[k];
    const links = vergleicheLinealSkalare(ohne, LINEAL);
    assert.equal(links.length, 1, `${k} fehlt im eigenen Pass`);
    assert.match(links[0], new RegExp(`^${k}: fehlt`));
    const rechts = vergleicheLinealSkalare(LINEAL, ohne);
    assert.equal(rechts.length, 1, `${k} fehlt im versiegelten Artefakt`);
    assert.match(rechts[0], new RegExp(`^${k}: fehlt`));
  }
  // Abwesenheits-Kontrolle: vollstaendige Seiten melden nichts.
  assert.deepEqual(vergleicheLinealSkalare(LINEAL, LINEAL), []);
  // Beidseitig fehlend ist EIN Verstoss mit beiden Seiten im Text (Review 29.08.).
  const beide = vergleicheLinealSkalare({ ...LINEAL, ipoBounds: undefined }, (() => { const o = { ...LINEAL }; delete o.ipoBounds; return o; })());
  assert.equal(beide.length, 1);
  assert.match(beide[0], /^ipoBounds: fehlt im eigenen Pass und im versiegelten Artefakt$/);
});

// JSON.stringify macht aus NaN/Infinity ein "null" — ohne Sonderbehandlung saehe ein
// degenerierter NaN-Skalar aus wie ein legitimes null der Gegenseite (unsichere
// Richtung: stiller Pass statt Widerspruch). Review-Befund 29.08., sofort gehaertet.
test('kanonisch(): NaN/Infinity/undefined sind von null unterscheidbar', () => {
  assert.notEqual(kanonisch(NaN), kanonisch(null));
  assert.notEqual(kanonisch(Infinity), kanonisch(null));
  assert.notEqual(kanonisch(NaN), kanonisch(Infinity));
  assert.notEqual(kanonisch(undefined), kanonisch(null));
  const v = vergleicheLinealSkalare({ ...LINEAL, cycleDDThreshold: NaN }, { ...LINEAL, cycleDDThreshold: null });
  assert.equal(v.length, 1, 'NaN gegen null MUSS ein Widerspruch sein');
  // Abwesenheits-Richtung: gleiche endliche Werte bleiben natuerlich sauber.
  assert.equal(kanonisch(0.5), kanonisch(0.5));
});

// Pfad-Vergleich gepinnt wie er IST (fail-closed): Gross/Kleinschreibung zaehlt als
// Widerspruch — auf NTFS ein moeglicher Fehlalarm, aber ein Fehlalarm blockt laut
// statt still durchzuwinken. Wer das lockert, muss diesen Pin bewusst umdrehen.
test('Umgebungs-Vorstufe: Pfadvergleich ist exakt (Case zaehlt, Slashes normalisiert)', () => {
  const ref = { modus: 'referenz', refCalib: 'protocol/x/lineal.json' };
  assert.equal(pruefeModusUmgebung(ref, 'protocol\\x\\lineal.json').length, 0, 'Slash-Richtung normalisiert path.resolve');
  assert.equal(pruefeModusUmgebung(ref, 'Protocol/x/Lineal.json').length, 1, 'Case-Abweichung bleibt ein Verstoss');
});
