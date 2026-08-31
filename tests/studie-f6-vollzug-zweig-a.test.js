'use strict';

// F6-A9 / F6-A12 / F6-A13 / F6-A14 — Vollzug Zweig A.
// Urteil _COURT-F6-BAND-2026-08-31.md, ratifiziert im ORCHESTRATOR-NACHTRAG 1
// am 2026-08-31; Vollzugsordnung Schritt 2.
//
// Der Waechter pinnt das OBJEKT, nicht seinen Text. Drei Anker, die keine
// Umformulierung ueberlebt:
//   (1) der inhaltSha256 wird vom Haus-Werkzeug NACHGERECHNET, nicht geglaubt —
//       und die Gegenprobe an einer mutierten Kopie zeigt, dass er wirklich
//       bindet;
//   (2) jede Anker-Kennung wird gegen das ECHTE Zugriffs-Register geprueft,
//       nicht gegen eine Kopie der Zeichenkette im Artefakt;
//   (3) jedes woertliche Zitat muss eine echte Teilzeichenkette des Feldes
//       sein, aus dem es stammt. Driftet die Quelle oder erfindet jemand ein
//       Zitat, faellt es hier auf.
//
// WAS DIESER TEST NICHT TUT: er kennt kein Messergebnis, oeffnet kein Siegel
// und liest keine Studiendaten. Die beiden Zahlen, die er rechnet, sind
// Struktur-Groessen aus der eingefrorenen Regel, keine Messwerte.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const python = process.env.PYTHON || 'python';
const WURZEL = path.join(__dirname, '..');
const p = (...teile) => path.join(WURZEL, ...teile);

const ARTEFAKT = p('protocol', 'early-detection', '2.1.0',
  'f6-vollzug-zweig-a-2026-08-31.json');
const HASH_WERKZEUG = p('scripts', 'studie-vb-b4-band.py');
const BAND = p('protocol', 'early-detection', '2.1.0', 'b4-bandregel-2026-08-30.json');
const PRAEREG = p('protocol', 'early-detection', '2.0.0', 'preregistration.json');
const REGISTER = p('protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');

const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));
const a = lies(ARTEFAKT);
const roh = fs.readFileSync(ARTEFAKT, 'utf8');

// Der Hash-Geltungsbereich ist der `inhalt`-Teilbaum (wie beim Band-Artefakt).
// Nachgerechnet wird mit dem Haus-Werkzeug: die Kanonisierung ist
// Python-definiert, und eine zweite Implementierung in JS driftet — genau der
// Fehler, den scripts/studie-f6-register.js im Kopf beschreibt.
function hashLauf(datei) {
  return spawnSync(python, [HASH_WERKZEUG, 'hash', '--datei', datei], { encoding: 'utf8' });
}

test('Grundform: das Artefakt meldet sich als vorbereiteter Gegenstand, nicht als Akt', () => {
  assert.equal(a.schema, 'studie-f6-vollzug-zweig-a/v1');
  assert.equal(a.vollzugsStatus.registriert, false);
  assert.deepEqual(a.vollzugsStatus.auflagen, ['F6-A9', 'F6-A12', 'F6-A13', 'F6-A14']);
  // Alle vier Auflagen tragen einen Inhaltsblock — eine fehlende faellt auf.
  for (const block of ['provenienz', 'erwartung', 'bWiderlegung', 'fensterSchluss']) {
    assert.ok(a.inhalt[block] && typeof a.inhalt[block] === 'object',
      `Block ${block} fehlt`);
  }
});

test('inhaltSha256: vom Haus-Werkzeug nachgerechnet, nicht geglaubt', () => {
  const r = hashLauf(ARTEFAKT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`inhaltSha256 gerechnet: ${a.inhaltSha256}`));
  assert.match(r.stdout, new RegExp('Datei-SHA-256\\s*:\\s*'
    + crypto.createHash('sha256').update(fs.readFileSync(ARTEFAKT)).digest('hex')));
});

test('GEGENPROBE: der Hash bindet den Inhalt wirklich — eine mutierte Kopie faellt auf', () => {
  // Ohne diese Probe wuesste niemand, ob die Pruefung oben ueberhaupt etwas
  // kann. Mutiert wird eine KOPIE; das Artefakt selbst wird nie angefasst.
  const kopie = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'f6-vollzug-')),
    'mutiert.json');
  try {
    const gefaelscht = JSON.parse(roh);
    gefaelscht.inhalt.bWiderlegung.noetigerFaktor.wert = 1.0;
    fs.writeFileSync(kopie, `${JSON.stringify(gefaelscht, null, 1)}\n`, 'utf8');
    const r = hashLauf(kopie);
    assert.equal(r.status, 1,
      'Der Hash-Waechter liess eine inhaltlich veraenderte Datei durch');
    assert.match(r.stdout + r.stderr, /HASH WEICHT AB/);
  } finally {
    fs.rmSync(path.dirname(kopie), { recursive: true, force: true });
  }
});

test('F6-A9: die Provenienz nennt Anker und Beziehung — und die Groesse selbst nicht', () => {
  const prov = a.inhalt.provenienz;
  assert.match(prov.feststellung, /NICHT blind/);
  assert.match(prov.transformation, /deterministische|SE_binomial/);
  assert.match(prov.zitierverbot, /NIE\s+Entscheidungsgroesse/);
  assert.ok(prov.anker.some((x) => /friedhof\.json:71/.test(x)),
    'Der Friedhofs-Anker fehlt');
  assert.ok(prov.anker.some((x) => /outcome-access-ledger\.json:635/.test(x)),
    'Der Register-Anker fehlt');
  // Das Band-Verdikt ist VORAB als erwartet beurkundet — das ist der Kern der
  // Auflage: hinterher darf es keine Ueberraschung sein.
  assert.match(prov.bandVerdiktVorabErwartet, /VORAB/);
  assert.match(prov.bandVerdiktVorabErwartet, /NICHT UNTERSCHEIDBAR/);
  // Der Dissens D3 wird nicht wegdefiniert.
  assert.match(prov.dissens, /D3/);
});

test('F6-A12: Erwartung ist bedingt, als Spanne, mit dem NICHT-BESTANDEN-Ast', () => {
  const e = a.inhalt.erwartung;
  assert.equal(e.pBand.spanne, '60-85 %');
  assert.match(e.pBand.binomial, /64 %/);
  assert.match(e.pBand.obereKante, /83 %/);
  // Die obere Kante haengt an einem NICHT registrierten Design-Effekt — ohne
  // diesen Zusatz waere die Spanne eine geschoente Punktprognose.
  assert.match(e.pBand.obereKante, /NICHT REGISTRIERTEN/);
  assert.match(e.pNichtBestanden.wert, /28 %/);
  assert.match(e.pNichtBestanden.bedeutung, /ZITIERFAEHIGE/);
  assert.match(e.pTorBestehenNachHausregel.wert, /7,7 %/);
  assert.match(e.pTorBestehenNachHausregel.etikett, /nicht 95-%-gesicherte Ueberlegenheit/);
  // F6-A11b: die Praemisse ist die LUECKE, nicht die Naehe zu 0,90.
  assert.match(e.praemisse, /LUECKE/);
  assert.match(e.praemisse, /d = 0/);
  assert.match(e.alleZahlenBedingt, /bedingte/);
});

test('F6-A13: die B-Widerlegung rechnet nach — beide Faktoren am Objekt geprueft', () => {
  const b = a.inhalt.bWiderlegung;
  // Nicht die Zahl im Text glauben, sondern sie herstellen.
  assert.equal(Number((1 / 0.42) ** 2).toFixed(3), '5.669');
  assert.equal(b.noetigerFaktor.wert, 5.669);
  assert.equal(Number(0.42 * Math.sqrt(5)).toFixed(3), '0.939');
  assert.equal(b.obergrenzeBeiBruchAllerMauern.wert, 0.939);
  assert.ok(b.obergrenzeBeiBruchAllerMauern.wert < 1,
    'Die Obergrenze muss unter 1 liegen — sonst faellt die ganze Widerlegung');
  assert.equal(b.kalender.legalErreichbarerFaktor, 1);
  // Blind: ohne jede Zaehlung entschieden.
  assert.match(b.ohneJedeZaehlung, /BLIND/);
  // Und die Begruendung, die NICHT traegt, steht ausdruecklich als solche da.
  assert.match(b.woranBNICHTstirbt, /berichtet es falsch/);
  assert.match(b.folge, /K-2/);
});

test('F6-A14: das Designaenderungs-Fenster ist geschlossen und nichts sonst', () => {
  const f = a.inhalt.fensterSchluss;
  assert.match(f.beurkundung, /NICHT MEHR GEAENDERT/);
  for (const muster of [/kein Start/, /kein Register-Eintrag 24/, /keine Siegel/]) {
    assert.ok(f.wasDamitNICHTbeschlossenIst.some((x) => muster.test(x)),
      `Die Nicht-Beschluss-Liste fuehrt ${muster} nicht`);
  }
});

test('Anker: jede Kennung gegen das ECHTE Register geprueft, nicht gegen sich selbst', () => {
  const ereignisse = lies(REGISTER).events;
  const beiRunId = (id) => ereignisse.findIndex((e) => e.runId === id);
  // Eintrag 21 — Formvorbild der Kontaminations-Vorgeschichte.
  const i21 = beiRunId('f3-konzeptliste-freeze-2026-08-30');
  assert.equal(i21, 20, 'Eintrag 21 steht nicht an Position 21');
  assert.ok(a.inhalt.provenienz.anker.some((x) => x.includes(ereignisse[i21].eventHash)),
    'Der Provenienz-Anker nennt nicht den echten eventHash von Eintrag 21');
  // Eintrag 23 — der Freeze-Akt, auf dem dieses Artefakt aufsetzt.
  const i23 = beiRunId('f6-tor-freeze-2026-08-31');
  assert.equal(i23, 22, 'Eintrag 23 steht nicht an Position 23');
  assert.equal(ereignisse[i23].typ, 'C0_REGELFREEZE');
  const hash23 = ereignisse[i23].eventHash;
  assert.ok(a.vollzugsStatus.kettenendeBeimBau.includes(hash23),
    'Das Artefakt nennt ein anderes Kettenende als das Register fuehrt');
  assert.ok(a.inhalt.bWiderlegung.guenstigesEndeGestrichen.grund.includes(hash23),
    'Die Streichung des guenstigen Endes beruft sich nicht auf den echten Eintrag 23');
  // Verkettung: Eintrag 23 haengt am Vorgaenger, nicht in der Luft.
  assert.equal(ereignisse[i23].previousHash, ereignisse[i23 - 1].eventHash);
});

test('Zitate: jedes woertliche Zitat ist eine echte Teilzeichenkette seiner Quelle', () => {
  const band = lies(BAND).inhalt;
  const splits = lies(PRAEREG).splits;
  const ereignisse = lies(REGISTER).events;
  const verboten22 = ereignisse[21].verboten;
  const verboten23 = ereignisse[22].verboten;

  const paare = [
    // Die max(SE)-Regel, aus der der Faktor 5,669 folgt.
    [band.vierGroessen['2_seRechenvorschrift'].formel,
      'SE* = max(SE_binomial(p-Dach), SE_klumpen-robust)'],
    [band.vierGroessen['2_seRechenvorschrift'].beidePflicht,
      'Beide aus DEMSELBEN Lauf, beide berichtet (A16); der groessere entscheidet.'],
    // Der Kalender.
    [splits.pruefung,
      '2017-01-01/2019-12-31 (Signalfenster) mit Pufferjahr 2020 fuer die Reife'],
    [splits.endtest,
      '2021-01-01/2023-12-31 (Signalfenster) mit Pufferjahr 2024 fuer die Reife'],
    [splits.endtest,
      'VERSCHLUESSELT (aes-256-gcm), Nachweis in endtest-versiegelung.json'],
    [splits.abweichungVonE2,
      'E2 hat sein Kalibrierungsband auf 2012-2016 gelegt und damit das Pufferjahr '
      + '2016 in das SIGNALband genommen.'],
    [splits.abweichungVonE2,
      'Signalband = Fensterjahre OHNE Pufferjahr, Reife darf das Pufferjahr nutzen'],
    // Die beiden Verbote, die Zweig B schliessen.
    [verboten22,
      'Jede zweite Jahrgangswahl (RR9-A3 Ziffer 5: genau EINE; ein Bau unter dem '
      + 'anderen Jahrgang ist ausschliesslich als praeregistrierte R6-Sensitivitaet '
      + 'zulaessig, nie als zweiter Torlauf)'],
    [verboten23,
      'als Entscheidungsgroesse (VB Paragraph 0.1 - Bezugspunkt ist genau der '
      + 'registrierte Anteil 0,90)'],
  ];

  for (const [quelle, zitat] of paare) {
    assert.ok(quelle.includes(zitat),
      `Zitat steht so nicht in seiner Quelle: ${zitat.slice(0, 60)}...`);
    assert.ok(roh.includes(zitat),
      `Das Artefakt fuehrt das gepruefte Zitat nicht: ${zitat.slice(0, 60)}...`);
  }
});

// -- Absenz ------------------------------------------------------------------
// Die realisierte Prueffenster-Groesse steht unter stehendem Zitierverbot. Sie
// wird ausschliesslich ueber Anker gefuehrt, nie als Wert. Gesucht werden die
// RATEN-FORMEN, nicht die blanke Ganzzahl: eine blanke Zahl kaeme in jedem
// zweiten SHA-256 zufaellig vor und machte den Waechter falsch-rot.
const GESPERRTE_FORMEN = ['89,32', '89.32', '90,4', '90.4', '326/365'];

test('Absenz: die realisierte Groesse steht nicht im Artefakt', () => {
  for (const form of GESPERRTE_FORMEN) {
    assert.ok(!roh.includes(form),
      `Das Artefakt traegt die gesperrte Groesse ${form}`);
  }
  assert.match(a.inhalt.provenienz.warumDieGroesseHierNichtSteht, /Anker/);
});

test('GEGENPROBE: der Absenz-Waechter wuerde die Groesse auch finden', () => {
  const boese = [
    '"realisiert": "89,32 %"',
    'Anteil 89.32 Prozent',
    'der Bruch 326/365 im Klartext',
    'Punktschaetzung 90,4',
  ];
  for (const zeile of boese) {
    assert.ok(GESPERRTE_FORMEN.some((form) => zeile.includes(form)),
      `Der Absenz-Waechter uebersieht: ${zeile}`);
  }
  // Und er darf nicht bei harmlosem Text anschlagen — sonst wird er abgeschaltet.
  for (const zeile of ['Faktor 5,669', 'd = 0,939 < 1', 'Spanne 60-85 %', a.inhaltSha256]) {
    assert.ok(!GESPERRTE_FORMEN.some((form) => zeile.includes(form)),
      `Der Absenz-Waechter schlaegt falsch an bei: ${zeile}`);
  }
});

test('Beschluss-Sperre: kein Satz sagt die Richtung der Messung voraus', () => {
  assert.match(a.inhalt.beschlussSperre, /die Richtung kennt heute niemand/);
  for (const muster of [/kein Register-Eintrag/, /keine Autorisierung des F6-Laufs/,
    /keine Siegel-Beruehrung/, /kein Datenzugriff/]) {
    assert.ok(a.inhalt.wasDiesesArtefaktNichtTut.some((x) => muster.test(x)),
      `Die Nicht-Liste fuehrt ${muster} nicht`);
  }
});
