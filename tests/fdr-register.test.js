'use strict';
// tests/fdr-register.test.js — Waechter fuer protocol/fdr-register-frueher-finden.json
//
// Die SACHE: das Register ist der LAUFENDE Nenner m der B-Teststrecke, an dem jeder
// weitere Test seine Benjamini-Yekutieli-Schwelle misst. Es ist eine KETTE, kein
// Logbuch. Wer einen Eintrag nachtraeglich aendert, herausschneidet, umordnet oder
// den Nenner senkt, macht die gesamte Linie nachtraeglich milder — das ist die
// Manipulation, gegen die dieses Register gebaut wurde (Urteil
// agent-reports/_COURT-B2-2026-08-30.md K2, Abhilfe 5.A A4, Reaktivierungs-Bedingung R5;
// ratifiziert als ENTSCHIED 42).
//
// Geprueft wird am ECHTEN, ausgelieferten Register — und jede der sieben
// Manipulationen muss rot werden. Ein Waechter, der nur synthetische Beispiele
// kennt, faellt beim ersten bestimmungsgemaessen Gebrauch nicht auf.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const REL = 'protocol/fdr-register-frueher-finden.json';
const DATEI = path.join(WURZEL, ...REL.split('/'));
const GENESIS = '0'.repeat(64);

const lade = () => JSON.parse(fs.readFileSync(DATEI, 'utf8'));
const klon = (o) => JSON.parse(JSON.stringify(o));

// Kanonische Form = alle Felder ausser dem eigenen Hash, Schluessel sortiert.
const kanonisch = (e) => JSON.stringify(e, Object.keys(e).filter((k) => k !== 'sha256').sort());
const hashOf = (e, prev) => crypto.createHash('sha256').update(prev + '|' + kanonisch(e)).digest('hex');

// ── Die drei Invarianten, je als eigene Pruefung ─────────────────────────────

// (I) KETTE: jeder Eintrag haengt am Vorgaenger. Aendern/Entfernen/Umordnen bricht sie.
function pruefeKette(reg) {
  assert.ok(Array.isArray(reg.eintraege) && reg.eintraege.length > 0, 'Register ohne Eintraege belegt nichts');
  let prev = GENESIS;
  reg.eintraege.forEach((e, i) => {
    assert.strictEqual(e.prevSha256, prev, 'Eintrag ' + i + ' (' + e.id + '): prevSha256 passt nicht zum Vorgaenger');
    const soll = hashOf(e, prev);
    assert.strictEqual(e.sha256, soll,
      'Eintrag ' + i + ' (' + e.id + '): sha256 falsch. Erwartet: ' + soll);
    prev = e.sha256;
  });
  assert.strictEqual(reg.kopfSha256, prev, 'kopfSha256 zeigt nicht auf das letzte Glied');
}

// (II) NENNER: m ist die Zahl der gezaehlten Eintraege — nicht frei gesetzt.
// Und art traegt die Regel: Schranken-Views zaehlen NIE (K2, 3:0).
function pruefeNenner(reg) {
  const c = (m) => { let s = 0; for (let i = 1; i <= m; i++) s += 1 / i; return +s.toFixed(6); };
  for (const e of reg.eintraege) {
    assert.ok(e.art === 'hypothesentest' || e.art === 'schranke', e.id + ': unbekannte art "' + e.art + '"');
    assert.strictEqual(typeof e.zaehltInM, 'boolean', e.id + ': zaehltInM fehlt oder ist kein Boolean');
    if (e.art === 'schranke') {
      assert.strictEqual(e.zaehltInM, false,
        e.id + ': eine Schranken-View darf NIE in m zaehlen (K2, 3:0) — sie erzeugt keinen p-Wert '
        + 'und kann ein Verdikt nur konservativer machen');
    } else {
      assert.strictEqual(e.zaehltInM, true, e.id + ': ein Hypothesentest MUSS in m zaehlen');
    }
  }
  const gezaehlt = reg.eintraege.filter((e) => e.zaehltInM).length;
  assert.strictEqual(reg.laufenderNenner, gezaehlt,
    'laufenderNenner (' + reg.laufenderNenner + ') weicht von den gezaehlten Eintraegen (' + gezaehlt + ') ab');
  assert.strictEqual(reg.byFaktorC, c(gezaehlt), 'byFaktorC passt nicht zu m = ' + gezaehlt);
  assert.strictEqual(reg.q, 0.10, 'BY laeuft bei q = 0,10 (K2)');
  assert.strictEqual(reg.verfahren, 'Benjamini-Yekutieli');
}

// (III) APPEND-ONLY: der committete Stand muss ein PRAEFIX des neuen sein, und
// m darf nie sinken. Ohne diese Pruefung waere "append-only" eine Behauptung.
function pruefeAppendOnly(alt, neu) {
  assert.ok(neu.eintraege.length >= alt.eintraege.length,
    'Eintraege verschwunden: ' + alt.eintraege.length + ' -> ' + neu.eintraege.length);
  alt.eintraege.forEach((a, i) => {
    assert.strictEqual(JSON.stringify(neu.eintraege[i]), JSON.stringify(a),
      'Eintrag ' + i + ' (' + a.id + ') wurde nachtraeglich geaendert oder umgeordnet — append-only verletzt');
  });
  assert.ok(neu.laufenderNenner >= alt.laufenderNenner,
    'm ist gesunken (' + alt.laufenderNenner + ' -> ' + neu.laufenderNenner + ') — der Nenner laeuft nur vorwaerts');
}

// ── DURCHGEHEN: das echte Register ───────────────────────────────────────────

const echt = lade();
pruefeKette(echt);
pruefeNenner(echt);
// Gepinnt wird der EROEFFNUNGSBESTAND, nicht der Tagesstand: m waechst
// bestimmungsgemaess mit jedem weiteren Test. Ein Waechter, der die aktuelle Zahl
// festnagelt, wird beim ersten korrekten Anhaengen rot und entwertet sich selbst.
assert.ok(echt.laufenderNenner >= 9,
  'm darf nie unter den vom Gericht gesetzten Start 9 fallen (B1s eingefrorene 6 + B2s drei Views, K2)');
assert.deepStrictEqual(
  echt.eintraege.filter((e) => e.zaehltInM).slice(0, 9).map((e) => e.id),
  ['B1-1', 'B1-2', 'B1-3', 'B1-4', 'B1-5', 'B1-6', 'B2-1', 'B2-2', 'B2-3'],
  'Eroeffnungsbestand steht unveraendert am Anfang der Kette (K2 Auflage 1: B1 wird eingetragen, nicht umregistriert)');
{ // Der BY-Faktor des Startbestands, unabhaengig von der Datei nachgerechnet.
  let s = 0; for (let i = 1; i <= 9; i++) s += 1 / i;
  assert.strictEqual(+s.toFixed(6), 2.828968, 'c(9) = Summe 1/i fuer i = 1..9');
}
assert.ok(echt.eintraege.some((e) => e.art === 'schranke'),
  'mindestens eine Schranken-View ist GEFUEHRT — die Ausnahme muss sichtbar sein, nicht fehlen');

// Gegen die committete Fassung, sobald es eine gibt (beim ersten Commit noch nicht).
{
  let alt = null;
  try {
    // stderr stumm: solange die Datei noch nicht committet ist, ist der Fehlschlag normal.
    alt = JSON.parse(execFileSync('git', ['show', 'HEAD:' + REL],
      { cwd: WURZEL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) { /* noch nicht committet — beim ersten Lauf normal */ }
  if (alt) pruefeAppendOnly(alt, echt);
}

// ── ROT WERDEN: jede Manipulation einzeln ────────────────────────────────────

const mussBrechen = (name, fn) => assert.throws(fn, (err) => err instanceof assert.AssertionError, 'MUSS rot werden: ' + name);

// (1) Eintrag herausgeschnitten.
mussBrechen('Eintrag entfernt', () => {
  const r = klon(echt); r.eintraege.splice(3, 1); pruefeKette(r);
});
// (2) Eintraege umgeordnet.
mussBrechen('Eintraege umgeordnet', () => {
  const r = klon(echt); const t = r.eintraege[1]; r.eintraege[1] = r.eintraege[2]; r.eintraege[2] = t; pruefeKette(r);
});
// (3) Bestehender Eintrag nachtraeglich umgeschrieben.
mussBrechen('Eintrag inhaltlich geaendert', () => {
  const r = klon(echt); r.eintraege[0].beschreibung = 'stillschweigend umdefiniert'; pruefeKette(r);
});
// (4) Schranken-View in den Nenner geschmuggelt — der Kern von K2.
mussBrechen('Schranken-View zaehlt plotzlich in m', () => {
  const r = klon(echt);
  const s = r.eintraege.find((e) => e.art === 'schranke');
  s.zaehltInM = true;
  pruefeNenner(r);
});
// (5) Hypothesentest aus dem Nenner genommen — dieselbe Manipulation andersherum.
mussBrechen('Hypothesentest faellt aus m', () => {
  const r = klon(echt);
  r.eintraege.find((e) => e.art === 'hypothesentest').zaehltInM = false;
  pruefeNenner(r);
});
// (6) Nenner frei gesetzt statt gezaehlt.
mussBrechen('laufenderNenner von Hand gesenkt', () => {
  const r = klon(echt); r.laufenderNenner = 6; pruefeNenner(r);
});
// (7) Append-only verletzt: committeter Eintrag im neuen Stand veraendert bzw. m gesunken.
mussBrechen('committeter Eintrag nachtraeglich geaendert', () => {
  const neu = klon(echt); neu.eintraege[0].status = 'zurueckgezogen'; pruefeAppendOnly(echt, neu);
});
mussBrechen('m gesunken', () => {
  const neu = klon(echt); neu.laufenderNenner = echt.laufenderNenner - 1; pruefeAppendOnly(echt, neu);
});

console.log('fdr-register.test.js: echtes Register gueltig (m = ' + echt.laufenderNenner
  + ', c = ' + echt.byFaktorC + '), alle 8 Manipulationen rot');
