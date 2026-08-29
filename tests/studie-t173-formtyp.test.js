'use strict';

// T173 — Formtyp-Zaehlung der periodenlosen Berichte.
//
// Die SACHE: der Zaehler darf nur `bericht.form` lesen, muss die bestehende
// `form_stem`-Normalisierung unveraendert benutzen und seine Aufschluesselung
// gegen den im SELBEN Lauf ermittelten Gesamtzaehler abgleichen. Vertrag:
// protocol/early-detection/2.0.0/r2-a1-t173-form-type-counter-addendum.json.
//
// Der Selbsttest des Skripts faehrt die drei vorgeschriebenen Belege je einmal
// intakt UND einmal absichtlich gebrochen. Er ist gruen nur, wenn jeder intakte
// Waechter gruen und jeder gebrochene rot war — ein Waechter, dessen Rotwerden
// nie beobachtet wurde, ist kein Beleg (addendum proofRule). Hier wird genau
// dieses Ergebnis in BEIDE Richtungen festgenagelt.
//
// Kein Panel-, Fakt-, Outcome- oder Endtest-Zugriff: der Selbsttest arbeitet
// ausschliesslich auf hermetischen In-Memory-Fixtures.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const WURZEL = path.join(__dirname, '..');
const SKRIPT = path.join(WURZEL, 'scripts', 'studie-t173-formtyp.py');
const ADDENDUM_SHA256 =
  'a7002de9b01c83bb025471ce1fc2c32faf3d947ca0f76e99eb4e6b5eb931dcc7';

function python(...argumente) {
  for (const befehl of ['python', 'python3']) {
    const lauf = spawnSync(befehl, [SKRIPT, ...argumente], { encoding: 'utf8' });
    if (!lauf.error) return lauf;
  }
  throw new Error('Kein python im PATH');
}

// Den eingefrorenen Vertrag selbst (Hash, Felder, die vier referenzierten
// frozen Records) nagelt bereits tests/studie-t173-form-type-counter-addendum.js
// fest — hier wird er nicht ein zweites Mal geprueft, sondern nur BENUTZT.
// Hier steht, was dort fehlt: das Verhalten des Zaehlers.

test('T173: der Selbsttest zeigt alle drei Belege intakt gruen und gebrochen rot', () => {
  const lauf = python('--selbsttest');
  assert.equal(lauf.status, 0, `Selbsttest rot:\n${lauf.stdout}\n${lauf.stderr}`);
  const ausgabe = lauf.stdout;
  // Beide Richtungen je Beleg — die GRUEN-Haelfte allein wuerde auch ein
  // Waechter bestehen, der nie ausloest.
  for (const beleg of ['zwei-fenster-waechter', 'sabotage-leck']) {
    assert.match(ausgabe, new RegExp(`\\[GRUEN\\] ${beleg} \\(intakt\\)`), `${beleg} intakt fehlt`);
    assert.match(ausgabe, new RegExp(`\\[ROT\\] ${beleg} \\(gebrochen\\)`), `${beleg} gebrochen fehlt`);
  }
  assert.match(ausgabe, /\[GRUEN\] normalisierung \(intakt\)/);
  assert.match(ausgabe, /\[ROT\] sabotage-fehlklassifikation \(gebrochen\)/);
  // Der Fehlklassifikations-Beleg muss Ist gegen Soll zeigen, nicht nur rot sein.
  assert.match(ausgabe, /Soll \(stamm, periodisch\)=\('6-K', False\), Ist \('10-K', True\)/);
  // Der Leck-Beleg muss den gebrochenen Vertrag benennen.
  assert.match(ausgabe, /sum\(nonperiodicReportsExcludedByForm\) == nonperiodicReportsExcluded/);
});

test('T173: der Zaehler liest keine verbotene Spalte und kein fremdes Fenster', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8');
  // Genau eine SQL-Abfrage, und die holt nur `form`.
  const abfragen = quelle.match(/SELECT [^"]*FROM bericht/g) || [];
  assert.deepEqual([...new Set(abfragen)], ['SELECT form FROM bericht']);
  assert.equal(/FROM fakt/.test(quelle), false, 'greift auf die Tabelle fakt zu');
  for (const verboten of ['endtest', 'adsh', 'cik', 'value', 'outcome', 'signal']) {
    assert.equal(
      new RegExp(`(SELECT|,)\\s*${verboten}\\b`, 'i').test(quelle), false,
      `liest die verbotene Groesse ${verboten}`,
    );
  }
});

test('T173: das Lauf-Ergebnis gleicht Summe gegen Gesamtzaehler ab', () => {
  const ziel = path.join(WURZEL, 'reports', 'studie', 'T173-formtyp-zaehlung-2026-08-29.json');
  if (!fs.existsSync(ziel)) return; // ponytail: Lauf-Ausgabe ist optional im Baum
  const roh = fs.readFileSync(ziel, 'utf8');
  const ausgabe = JSON.parse(roh);
  assert.equal(ausgabe.addendum.sha256, ADDENDUM_SHA256);
  assert.deepEqual(ausgabe.readColumns, ['bericht.form']);
  assert.equal(ausgabe.reconciliation.sameRunOnly, true);
  assert.deepEqual(ausgabe.windows.map((f) => f.window), ['entdeckung', 'pruefung']);
  // Datei-Reihenfolge der Karten, in Fenster-Reihenfolge des Arrays.
  const karten_bloecke = roh
    .split('"nonperiodicReportsExcludedByForm": {')
    .slice(1)
    .map((teil) => teil.slice(0, teil.indexOf('}')));
  assert.equal(karten_bloecke.length, ausgabe.windows.length);

  for (const [i, fenster] of ausgabe.windows.entries()) {
    const karte = fenster.nonperiodicReportsExcludedByForm;
    const summe = Object.values(karte).reduce((a, b) => a + b, 0);
    assert.equal(summe, fenster.nonperiodicReportsExcluded,
      `Summenabgleich ${fenster.window} gebrochen`);
    // Sortierte Schluessel — zwei Laeufe muessen byte-identisch sein. Geprueft
    // wird die DATEI-Reihenfolge, nicht Object.keys(): JavaScript zieht
    // ganzzahlig aussehende Schluessel wie "425" nach vorn und wuerde eine
    // korrekt sortierte Datei faelschlich als unsortiert melden.
    const datei_reihenfolge = [...karten_bloecke[i].matchAll(/"([^"]+)": \d+/g)]
      .map((m) => m[1]);
    assert.deepEqual(datei_reihenfolge, Object.keys(karte).sort());
    // Kein periodischer Formtyp darf in der Karte stehen.
    for (const stamm of Object.keys(karte)) {
      assert.equal(['10-K', '10-Q', '20-F', '40-F'].includes(stamm), false,
        `periodischer Formtyp ${stamm} in der Karte`);
    }
    // Leere Karte nur bei Gesamtzaehler 0 (emptyMapSemantics).
    if (Object.keys(karte).length === 0) assert.equal(fenster.nonperiodicReportsExcluded, 0);
  }
});
