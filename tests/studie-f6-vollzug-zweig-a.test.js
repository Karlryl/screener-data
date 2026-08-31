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
const FRIEDHOF = p('protocol', 'early-detection', '2.0.0', 'friedhof.json');

// Der registrierte SOLLWERT, literal gepinnt. Ohne ihn vergliche dieser Test die
// Datei nur mit sich selbst: `a.inhaltSha256` stammt aus der Datei unter Pruefung,
// und das Haus-Werkzeug prueft ebenfalls nur die INNERE Konsistenz. Ein Commit,
// der Inhalt UND Hash-Feld zugleich verstellt, kam damit gruen durch (im Review an
// einer Kopie reproduziert). Register-Eintrag 24 wird genau diesen Wert zitieren.
const INHALT_SHA256 = '792f4ff58687945167e273d08ca509544f4ad7fd7ecd9eaa60d5dac3118c99f7';

const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));
const a = lies(ARTEFAKT);
const roh = fs.readFileSync(ARTEFAKT, 'utf8');

// spawnSync liefert bei einem Startfehler stdout/stderr als undefined — die
// naive Verkettung ergaebe dann "NaN" statt einer Diagnose.
const diagnose = (r) => `${r.stdout || ''}${r.stderr || ''}`
  + (r.error ? ` [spawn: ${r.error.code || r.error.message}]` : '');

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
  // Felder AUSSERHALB des Hash-Geltungsbereichs. Der inhaltSha256 deckt nur den
  // `inhalt`-Teilbaum — diese beiden liegen daneben und waren deshalb frei
  // umschreibbar: im Review wurden sie auf "dieser Eintrag autorisiert den Lauf"
  // umgeschrieben, und der Waechter blieb gruen. Sie werden hier einzeln gepinnt.
  assert.match(a.kanonisierung, /der inhalt-Teilbaum/);
  assert.match(a.vollzugsStatus.warumNochNichtRegistriert, /nicht der Akt|eigener Akt/);
});

test('inhaltSha256: gegen den registrierten Sollwert, nicht gegen sich selbst', () => {
  assert.match(a.inhaltSha256, /^[0-9a-f]{64}$/,
    'inhaltSha256 hat nicht die Form eines SHA-256 — als RegExp eingesetzt waere er unberechenbar');
  assert.equal(a.inhaltSha256, INHALT_SHA256,
    'Der inhaltSha256 weicht vom registrierten Sollwert ab. Eintrag 24 zitiert diesen Wert — '
    + 'eine Aenderung am Artefakt ist hier NICHT durch Mitziehen des Hash-Feldes zu heilen.');
  const r = hashLauf(ARTEFAKT);
  assert.equal(r.status, 0, diagnose(r));
  assert.match(r.stdout, new RegExp(`inhaltSha256 gerechnet: ${INHALT_SHA256}`));
  // ponytail: diese Zeile pinnt NUR das Ausgabeformat des Werkzeugs, sie ist keine
  // Manipulations-Sicherung — der Datei-Hash wird aus derselben Datei gerechnet, die
  // geprueft wird. Die Beweislast traegt der literale Sollwert oben.
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
  // d_alt wird aus dem Rechenweg GELESEN, nicht hier hartkodiert. Sonst bliebe ein
  // verstellter Rechenweg (d_alt = 0,50 bei unveraendertem wert 5.669) gruen: die
  // Rechnung wuerde dann gegen eine Konstante im Test pruefen statt gegen die
  // Groesse, die das Artefakt behauptet.
  const treffer = b.noetigerFaktor.rechenweg.match(/d_alt\s*=\s*(\d+[.,]\d+)/);
  assert.ok(treffer, 'd_alt steht nicht im Rechenweg — die Herleitung ist nicht pruefbar');
  const dAlt = Number(treffer[1].replace(',', '.'));
  assert.ok(dAlt > 0 && dAlt < 1, `d_alt ausserhalb des plausiblen Bereichs: ${dAlt}`);
  // Nicht die Zahl im Text glauben, sondern sie aus dem gelesenen d_alt herstellen.
  assert.equal(Number((1 / dAlt) ** 2).toFixed(3), '5.669');
  assert.equal(b.noetigerFaktor.wert, 5.669);
  assert.equal(Number(dAlt * Math.sqrt(5)).toFixed(3), '0.939');
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
  // Nach runId gesucht, nicht nach blankem Index (Hausmuster, vgl.
  // studie-f6-register.test.js): ein vorgeschobener Eintrag wuerde die Indizes
  // verschieben und den Test lautlos auf fremde Felder zeigen lassen.
  const beiRunId = (id) => {
    const e = ereignisse.find((x) => x.runId === id);
    assert.ok(e, `Register-Eintrag ${id} nicht gefunden`);
    return e;
  };
  const verboten22 = beiRunId('rr9-a3-jahrgang-registrierung-2026-08-30').verboten;
  const verboten23 = beiRunId('f6-tor-freeze-2026-08-31').verboten;

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

  // Ohne diese Zeile liefe die Schleife ueber eine leere Liste gruen durch — ein
  // geleertes `paare` war im Review ein stiller Durchgang.
  assert.equal(paare.length, 9, 'Die Zitat-Liste ist nicht mehr vollstaendig');

  for (const [quelle, zitat] of paare) {
    assert.ok(quelle.includes(zitat),
      `Zitat steht so nicht in seiner Quelle: ${zitat.slice(0, 60)}...`);
    assert.ok(roh.includes(zitat),
      `Das Artefakt fuehrt das gepruefte Zitat nicht: ${zitat.slice(0, 60)}...`);
  }
});

// -- Absenz ------------------------------------------------------------------
// Die realisierte Prueffenster-Groesse steht unter stehendem Zitierverbot und wird
// ausschliesslich ueber Anker gefuehrt, nie als Wert.
//
// WAS DIESER WAECHTER LEISTET UND WAS NICHT: er haelt die SCHREIBWEISEN drausssen,
// in denen das Haus die Groesse fuehrt. Er macht sie nicht unauffindbar — aus d_alt
// ist sie arithmetisch rekonstruierbar, und genau das ist die vom Rat ratifizierte
// Anker-und-Beziehung-Form (F6-A9), im Artefakt offengelegt. Der Test heisst
// deshalb nach dem, was er wirklich prueft.
//
// Eine Literal-Liste liess "326 von 365", "89,3" und die Anteils-Schreibweise glatt
// durch (im Review reproduziert); deshalb ein Muster statt einer Aufzaehlung. Die
// BLANKE Ganzzahl bleibt bewusst ungesucht: sie kaeme in jedem zweiten SHA-256
// zufaellig vor und machte den Waechter falsch-rot — und ein falsch-roter Waechter
// wird abgeschaltet.
const GESPERRT = /89[.,]3\d?|0[.,]893\d?|326\s*(\/|von)\s*365|0[.,]685\s*Prozentpunkte|90[.,]4/;

test('Absenz: die gesperrten Schreibweisen stehen nicht im Artefakt', () => {
  const fund = roh.match(GESPERRT);
  assert.equal(fund, null,
    `Das Artefakt traegt eine gesperrte Schreibweise: ${fund && fund[0]}`);
  assert.match(a.inhalt.provenienz.warumDieGroesseHierNichtSteht, /Anker/);
});

test('GEGENPROBE: der Absenz-Waechter findet jede Schreibweise — und schweigt sonst', () => {
  // Eine Probe je Kodierung, die der Literal-Liste durchgerutscht ist.
  const boese = [
    '"realisiert": "89,32 %"',
    'Anteil 89.32 Prozent',
    'ein gerissenes Tor bei 89,3 %',
    'Anteil 0,8932 auf dem alten Nenner',
    'p-Dach = 0.8932',
    'der Bruch 326/365 im Klartext',
    '326 von 365 reifen Firmen',
    'die Luecke betraegt 0,685 Prozentpunkte',
    'Punktschaetzung 90,4',
  ];
  for (const zeile of boese) {
    assert.ok(GESPERRT.test(zeile), `Der Absenz-Waechter uebersieht: ${zeile}`);
  }
  // Und er darf nicht bei harmlosem Text anschlagen — sonst wird er abgeschaltet.
  for (const zeile of ['Faktor 5,669', 'd = 0,939 < 1', 'Spanne 60-85 %',
    'rund 28 %', 'rund 7,7 %', 'Anteil 0,90', a.inhaltSha256]) {
    assert.ok(!GESPERRT.test(zeile),
      `Der Absenz-Waechter schlaegt falsch an bei: ${zeile}`);
  }
});

test('Zeilen-Anker: die zitierten Zeilen tragen noch, was das Artefakt behauptet', () => {
  // Bewusst assert.ok mit EIGENER Meldung statt assert.match: eine
  // Standard-Fehlermeldung schriebe die Zeile im Klartext ins CI-Protokoll — und
  // ledger:635 wie friedhof:71 fuehren genau die Groesse, die unter Zitierverbot
  // steht. Der Test liest sie, gibt sie aber unter keinen Umstaenden aus.
  const zeile = (datei, nr) => (fs.readFileSync(datei, 'utf8').split('\n')[nr - 1] || '');
  for (const [datei, nr, marke, name] of [
    [REGISTER, 635, 'Kontaminations-Vorgeschichte', 'outcome-access-ledger.json:635'],
    [REGISTER, 650, 'Jede zweite Jahrgangswahl', 'outcome-access-ledger.json:650'],
    [FRIEDHOF, 71, 'Fehlbetrag', 'friedhof.json:71'],
  ]) {
    assert.ok(zeile(datei, nr).includes(marke),
      `${name} traegt die erwartete Marke nicht mehr — der Anker im Artefakt zeigt ins Leere`);
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
