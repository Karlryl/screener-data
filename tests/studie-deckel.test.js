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
//
// Gegenrede-Befund 16.08.: die ersten vier Muster fanden nur NUTZERVERZEICHNISSE.
// R12a verbietet aber jeden absoluten Pfad — D:\sec-store\panel.sqlite oder
// /opt/sec-data/store waeren genauso maschinengebunden und rutschten glatt durch.
// Die letzten beiden Muster schliessen das: Laufwerksbuchstabe mit beliebigem Ziel und
// die Unix-Systemwurzeln. Beide verlangen einen Trenner davor, damit eine URL
// (https://…/files/…) und ein relativer Repo-Pfad weiter durchgehen.
const PFAD_MUSTER = [
  { name: 'Windows-Laufwerkspfad', regex: /\b[A-Za-z]:[\\/]{1,2}Users\b/ },
  { name: 'Windows-Nutzerverzeichnis', regex: /[\\/]Users[\\/][A-Za-z]/ },
  { name: 'Unix-Heimverzeichnis', regex: /(^|[\s"'(=])\/home\/[a-z]/m },
  { name: 'Umgebungs-Nutzerpfad', regex: /%USERPROFILE%|\$HOME\b/ },
  { name: 'Windows-Laufwerkspfad, beliebiges Ziel', regex: /(^|[\s"'(=[,])[A-Za-z]:[\\/]{1,2}[A-Za-z0-9_.-]/m },
  {
    name: 'Unix-Systempfad',
    regex: /(^|[\s"'(=[,])\/(opt|srv|mnt|media|var|usr|etc|data|tmp|root|Volumes)\/[A-Za-z0-9_.-]/m,
  },
];

function studienArtefakte() {
  const treffer = [];
  const wurzeln = [
    path.join(REPO, 'protocol', 'early-detection', '2.0.0'),
    path.join(REPO, 'protocol', 'strang-c'),
    path.join(REPO, 'reports', 'studie'),
    path.join(REPO, 'research', 'studie'),
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

// Uebersetzt ein .gitattributes-Muster in einen Regex. Bewusst ohne git-Aufruf: der
// Waechter soll auch dann urteilen, wenn er ausserhalb eines Checkouts laeuft.
function musterAlsRegex(muster) {
  const roh = muster.startsWith('/') ? muster.slice(1) : muster;
  const teile = roh.split('**').map((teil) =>
    teil.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'),
  );
  const kern = teile.join('.*');
  return new RegExp(`^${muster.startsWith('/') ? '' : '(.*/)?'}${kern}$`);
}

test('R12b: jedes Studien-Artefakt ist in .gitattributes auf LF gepinnt', () => {
  // Gegenrede-Befund 16.08.: die neuen studie-Pfade trugen KEINE eol-Regel, obwohl
  // jedes early-detection-Pfadmuster sie traegt. Folgenlos, solange kein Waechter ihre
  // Rohbytes hasht — und genau das baut E1. Eine ungepinnte Datei kann auf einer
  // Windows-Maschine mit anderen Bytes im Baum liegen als im CI, und dann ist ein
  // Hash-Beweis kein Beweis mehr.
  const zeilen = fs
    .readFileSync(path.join(REPO, '.gitattributes'), 'utf8')
    .split(/\r?\n/)
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile.length > 0 && !zeile.startsWith('#'));
  const regeln = zeilen.map((zeile) => {
    const [muster, ...attribute] = zeile.split(/\s+/);
    return { muster, regex: musterAlsRegex(muster), attribute };
  });
  // Gegenprobe am Uebersetzer selbst: er muss treffen UND danebenliegen koennen.
  assert.ok(musterAlsRegex('/reports/studie/**').test('reports/studie/tief/x.md'));
  assert.ok(!musterAlsRegex('/reports/studie/**').test('reports/andere/x.md'));
  assert.ok(musterAlsRegex('/tests/studie-*.test.js').test('tests/studie-deckel.test.js'));
  assert.ok(!musterAlsRegex('/tests/studie-*.test.js').test('tests/studie/tief.test.js'));

  for (const datei of studienArtefakte().concat([__filename])) {
    const relativ = path.relative(REPO, datei).split(path.sep).join('/');
    const passend = regeln.filter((regel) => regel.regex.test(relativ));
    const gepinnt = passend.some(
      (regel) => regel.attribute.includes('-text') || (regel.attribute.includes('text') && regel.attribute.includes('eol=lf')),
    );
    assert.ok(
      gepinnt,
      `${relativ}: keine LF-Pinnung in .gitattributes (passende Regeln: ${passend.map((r) => r.muster).join(', ') || 'keine'})`,
    );
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
    // Kein Nutzerverzeichnis und trotzdem maschinengebunden — genau das Loch, das der
    // Waechter bis zum 16.08. hatte.
    'D:\\sec-store\\panel.sqlite',
    'E:/studie/panel.parquet',
    '"dataRoot": "/opt/sec-data/store"',
    'STORE=/var/lib/studie/panel.sqlite',
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
    '"erfasstAm": "2026-08-16T11:23:39.184Z"',
    'run: node scripts/studie-mitschrift.js erfassen',
  ];
  for (const zeile of harmlos) {
    assert.ok(
      !PFAD_MUSTER.some((muster) => muster.regex.test(zeile)),
      `Der Pfad-Waechter schlaegt falsch an bei: ${zeile}`,
    );
  }
});
