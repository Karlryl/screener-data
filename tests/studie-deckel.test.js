'use strict';

// R14a Apparat-Deckel und R12a Maschinen-Unabhaengigkeit.
//
// Die SACHE: der Altapparat starb an 26-MB-Vertraegen und 43-MB-Skripten. Der Deckel
// gilt deshalb TYPFREI — Skripte und Reports zaehlen mit, nicht nur JSON. Und kein
// neues Studien-Artefakt darf einen absoluten Pfad oder ein Nutzerverzeichnis als
// Gueltigkeitsbedingung tragen: der Speicherort kommt aus einer Umgebungsvariablen,
// sonst kann kein anderer Motor und keine andere Maschine weiterarbeiten.
//
// Die Suche laeuft NUR ueber die neuen 2.0.0-Artefakte. Auf der versiegelten
// Alt-Evidenz waere sie am Tag 1 falsch-rot — das war der Angriff P1.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const DECKEL_BYTES = 200 * 1024;

// Absolute Pfade und Nutzerverzeichnisse — bewusst pfadFOERMIG gesucht, damit ein
// blosses Wort in einem Fliesstext keinen Fehlalarm ausloest.
const PFAD_MUSTER = [
  { name: 'Windows-Laufwerkspfad', regex: /\b[A-Za-z]:[\\/]{1,2}Users\b/ },
  { name: 'Windows-Nutzerverzeichnis', regex: /[\\/]Users[\\/][A-Za-z]/ },
  { name: 'Unix-Heimverzeichnis', regex: /(^|[\s"'(=])\/home\/[a-z]/m },
  { name: 'Umgebungs-Nutzerpfad', regex: /%USERPROFILE%|\$HOME\b/ },
];

function studienArtefakte() {
  const treffer = [];
  const wurzeln = [
    path.join(REPO, 'protocol', 'early-detection', '2.0.0'),
    path.join(REPO, 'reports', 'studie'),
  ];
  for (const wurzel of wurzeln) {
    if (!fs.existsSync(wurzel)) continue;
    for (const eintrag of fs.readdirSync(wurzel, { withFileTypes: true, recursive: true })) {
      if (!eintrag.isFile()) continue;
      treffer.push(path.join(eintrag.parentPath || eintrag.path, eintrag.name));
    }
  }
  for (const [ordner, muster] of [
    ['scripts', /^studie-.*\.(py|js)$/],
    ['lib', /^studie-.*\.js$/],
    ['tests', /^studie-.*test\.js$/],
  ]) {
    const wurzel = path.join(REPO, ordner);
    for (const name of fs.readdirSync(wurzel)) {
      // Einzige Ausnahme, und sie steht hier statt in einer Liste: diese Datei fuehrt
      // die Gegenprobe-Beispiele mit echten Pfadformen im Text. Wuerde sie sich selbst
      // scannen, waere der Waechter am Tag 1 falsch-rot — dieselbe Falle wie P1.
      if (name === path.basename(__filename)) continue;
      if (muster.test(name)) treffer.push(path.join(wurzel, name));
    }
  }
  return treffer;
}

test('Studien-Artefakte gefunden — ein leerer Waechter waere kein Waechter', () => {
  const dateien = studienArtefakte();
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Studien-Artefakte gefunden — Suchpfade stimmen nicht`);
});

test('R14a: kein Studien-Artefakt ueber 200 KB, typfrei', () => {
  for (const datei of studienArtefakte()) {
    const bytes = fs.statSync(datei).size;
    assert.ok(
      bytes < DECKEL_BYTES,
      `${path.relative(REPO, datei)} ist ${Math.round(bytes / 1024)} KB — Deckel sind 200 KB, auch fuer Skripte und Reports`,
    );
  }
});

test('R12a: kein absoluter Pfad und kein Nutzerverzeichnis in einem 2.0.0-Artefakt', () => {
  for (const datei of studienArtefakte()) {
    const text = fs.readFileSync(datei, 'utf8');
    for (const muster of PFAD_MUSTER) {
      const treffer = muster.regex.exec(text);
      assert.equal(
        treffer,
        null,
        `${path.relative(REPO, datei)}: ${muster.name} gefunden (${treffer && treffer[0]}) — der Speicherort gehoert in EARLY_DETECTION_DATA_ROOT`,
      );
    }
  }
});

test('R12a: der Waechter wuerde einen echten absoluten Pfad auch finden', () => {
  // Gegenprobe am Muster selbst: eine gueltige Form muss durchgehen, eine kaputte
  // auffliegen. Sonst wuesste niemand, ob die Suche oben ueberhaupt etwas kann.
  const boese = [
    'C:\\Users\\jemand\\daten\\panel.sqlite',
    '"dataRoot": "/Users/jemand/store"',
    'export ROOT=/home/jemand/store',
    'set ROOT=%USERPROFILE%\\store',
  ];
  for (const zeile of boese) {
    assert.ok(
      PFAD_MUSTER.some((muster) => muster.regex.test(zeile)),
      `Der Pfad-Waechter uebersieht: ${zeile}`,
    );
  }
  const harmlos = [
    '"sourceUrl": "https://www.sec.gov/files/dera/data/financial-statement-data-sets/2009q1.zip"',
    'const wurzel = process.env.EARLY_DETECTION_DATA_ROOT;',
    'protocol/early-detection/2.0.0/data-contract.json',
  ];
  for (const zeile of harmlos) {
    assert.ok(
      !PFAD_MUSTER.some((muster) => muster.regex.test(zeile)),
      `Der Pfad-Waechter schlaegt falsch an bei: ${zeile}`,
    );
  }
});
