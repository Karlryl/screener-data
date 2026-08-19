'use strict';

// E4a — Die Klassen-Zerlegung der Reife.
//
// DIE SACHE: E4a soll erklaeren, WARUM die Auffindbarkeit reisst. Eine Zerlegung, die
// eine Klasse falsch buchen kann, ohne dass es auffliegt, erklaert nichts — sie
// bestaetigt nur die Hypothese, mit der man hereingekommen ist. Deshalb wird hier
// nicht "Exit-Code 0" geprueft, sondern: DIESE Pruefung stand da und war gruen.
//
// Das Fixture des Selbsttests traegt den Unterschied wirklich: je eine Firma der
// Klassen (a), (b1), (b2) und (c), eine reife Firma, und dieselben fuenf Firmen ein
// zweites Mal unter der Ein-Kennungs-Variante S-G. Ohne diese Firmen koennte die
// Sabotage einer einzelnen Klasse gar nicht auffliegen — genau daran ist die Sitzung
// am 19.08. mehrfach vorbeigeschrammt.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { allowlistAus } = require('../scripts/studie-r1-serverzeit.js');
const { VerfassungsBruch } = require('../lib/studie-verfassung.js');

const REPO = path.join(__dirname, '..');
const SKRIPT = path.join(REPO, 'scripts', 'studie-e4a-diagnose.py');
const LEDGER = path.join(REPO, 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');

function diagnose(args, optionen = {}) {
  return spawnSync(process.env.PYTHON || 'python', [SKRIPT, ...args],
    { encoding: 'utf8', cwd: REPO, ...optionen });
}

let selbsttest = null;
function selbsttestLauf() {
  if (selbsttest === null) selbsttest = diagnose(['--selbsttest']);
  return selbsttest;
}

// Namentlich erwartet. Faellt eine dieser Zeilen weg, ist der Test rot — auch wenn
// der Selbsttest weiter Exit-Code 0 meldet.
const PFLICHT_PRUEFUNGEN = [
  'das Fixture erzeugt genau fuenf Erst-Ereignis-Firmen',
  'genau eine Firma ist reif',
  'Klasse (a) - keine Folgequartale - kommt genau einmal vor',
  'Klasse (b) - Kennungswechsel - kommt genau zweimal vor',
  'Klasse (b1) - nur der Kennungsname wechselt - genau einmal',
  'Klasse (b2) - auch die Waehrungseinheit wechselt - genau einmal',
  'Klasse (c) - zu wenige Folgequartale - kommt genau einmal vor',
  'Klasse (d) bleibt leer - jede Feuerung steht in der Reihe',
  'die Klassen summieren sich auf die unreifen Firmen',
  'die Auffindbarkeit ist 1 von 5',
  'die hypothetische Quote steigt um GENAU Klasse (b): 3 von 5',
  'die hypothetische Rechnung aendert die echte Fallzahl NICHT',
  'der Jahresverlauf fuehrt genau die Jahre 2018 und 2019',
  '2018 traegt vier Erst-Ereignis-Firmen',
  '2019 traegt die spaete Firma der Klasse (c)',
  '2018 traegt keine Klasse-(c)-Firma',
  'die Jahreszahlen summieren sich auf die Bandzahl',
  'die zweite Jahresachse (Bilanzstichtag) summiert sich auch',
  'die beiden Jahresachsen sind NICHT dieselbe Achse',
  'der Kontrollarm laeuft durch denselben Code und ist gefuellt',
  'S-G sieht dieselben fuenf Erst-Ereignis-Firmen',
  'S-G hat KEINEN Kennungswechsel - die Kontrollgruppe traegt',
  'S-G ist bei drei Firmen reif, S-U nur bei einer',
  'S-G verliert dieselben echten Ausfaelle wie S-U',
  'die gueltige Ausgabe geht DURCH',
  'ein geleckter Kennungsname fliegt auf',
  'ein geleckter Wachstumswert fliegt am Typ auf',
  'eine Quote ausserhalb [0,1] fliegt auf',
  'eine WEGGELASSENE Pflichtgroesse fliegt auch auf',
  'ein geleckter Zaehler in der JAHRESachse fliegt auf',
  'eine Ausgabe ohne Baender besteht die Pruefung NICHT',
  'kein Folgequartal-Wert im Output (Marker 0.777)',
  'keine Firmen-Kennung im Output',
  'kein Umsatz-Kennungsname im Output',
  'eine Zerlegung, die nicht aufgeht, bricht ab',
  'eine hypothetische Fallzahl neben Klasse (b) bricht ab',
  'eine Quote ueber 1 heisst NICHT BERECHENBAR statt Zahl',
  'die Fensterkanten-Ausnahme haelt die uebrigen Invarianten ein',
  'mehr reife Firmen als Nenner OHNE Zensur bricht ab',
  'und zwar an DIESER Invariante, nicht an einer frueheren',
  'das Endtest-Fenster wird nicht geoeffnet',
  'diese Datei enthaelt keinen Entschluesselungs-Aufruf',
];

test('Der Selbsttest der E4a-Diagnose laeuft gruen durch', () => {
  const lauf = selbsttestLauf();
  assert.equal(lauf.status, 0, `Exit ${lauf.status}\n${lauf.stdout}\n${lauf.stderr}`);
  assert.ok(!/^\s*ROT\s/m.test(lauf.stdout), lauf.stdout);
});

test('Jede Pflichtpruefung stand wirklich da — und war gruen', () => {
  const lauf = selbsttestLauf();
  const gruen = new Set(
    lauf.stdout.split(/\r?\n/)
      .filter((zeile) => /^\s{2}ok\s{4}/.test(zeile))
      .map((zeile) => zeile.replace(/^\s{2}ok\s{4}/, '').trim()),
  );
  const fehlend = PFLICHT_PRUEFUNGEN.filter((name) => !gruen.has(name));
  assert.deepEqual(fehlend, [], `Diese Pruefungen fehlen im Selbsttest: ${fehlend.join(' | ')}`);
  assert.ok(gruen.size >= PFLICHT_PRUEFUNGEN.length,
    `Nur ${gruen.size} gruene Pruefungen — der Selbsttest ist geschrumpft`);
});

// ── Die Sperrzone ────────────────────────────────────────────────────────────

test('Das Endtest-Fenster ist auf der Kommandozeile gar nicht erreichbar', () => {
  const lauf = diagnose(['--fenster', 'endtest']);
  assert.notEqual(lauf.status, 0, 'Der Endtest haette abgewiesen werden muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /invalid choice|ungueltige|SPERRZONE/i);
});

test('Die Diagnose fasst weder Schluessel noch verschluesselte Datei an', () => {
  const quelle = fs.readFileSync(SKRIPT, 'utf8').toLowerCase();
  // Suchbegriffe zusammengesetzt, sonst stuende dieser Test in seinem eigenen
  // Suchraum (dieselbe Falle wie im Selbsttest der Zaehlprobe).
  for (const wort of [`de${'crypt'}`, `ci${'pher'}`, `un${'seal'}`, `open${'ssl'}`]) {
    assert.ok(!quelle.includes(wort), `Die Diagnose enthaelt '${wort}'`);
  }
});

// ── W9: was ausgegeben wird, muss angemeldet sein ────────────────────────────

const REGISTER = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));

function freigabeDatei(verzeichnis, eintrag, aenderung = {}) {
  const pfad = path.join(verzeichnis, 'freigabe.json');
  fs.writeFileSync(pfad, JSON.stringify({
    runId: eintrag.runId,
    fenster: (eintrag.fenster || [])[0],
    registerEventHash: eintrag.eventHash,
    accessedAt: eintrag.accessedAt,
    serverConfirmedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    ...aenderung,
  }), 'utf8');
  return pfad;
}

test('W9: eine Freigabe der ZAEHLPROBE deckt die Diagnose nicht', () => {
  // Der E3-Eintrag ist eine gueltige Zaehlproben-Anmeldung — aber er meldet die
  // elf Zaehlprobenfelder an, nicht die Diagnosefelder. Wer mit ihm die Diagnose
  // faehrt, gibt mehr aus, als er angemeldet hat. Genau das muss auffliegen.
  const e3 = [...REGISTER.events].find(
    (e) => e.runId === 'e3-zaehlprobe-pruefung-2026-08-19-neulauf');
  assert.ok(e3, 'Der E3-Eintrag fehlt im Register — dann prueft W9 nichts');
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4a-w9-'));
  const lauf = diagnose(['--fenster', 'pruefung', '--freigabe',
    freigabeDatei(verzeichnis, e3), '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0, 'Der Lauf haette abbrechen muessen');
  assert.match(`${lauf.stdout}${lauf.stderr}`, /W9-ABBRUCH/);
});

test('W2: gar keine Freigabe heisst gar keine Diagnose', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4a-w2-'));
  const lauf = diagnose(['--fenster', 'pruefung', '--data-root', verzeichnis]);
  assert.notEqual(lauf.status, 0);
  assert.match(`${lauf.stdout}${lauf.stderr}`, /W2-ABBRUCH/);
});

// ── Die Allowlist-Anmeldung (R1-Erweiterung fuer E4a) ────────────────────────

test('Die Anmeldung nimmt die Allowlist des Laufs — und weist kaputte ab', () => {
  const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'e4a-allow-'));
  const praereg = { zaehlprobe: { ausgabeAllowlist: ['fallzahl', 'auffindbarkeit'] } };

  // Ohne Datei: unveraendert die Allowlist der versiegelten Zaehlprobe.
  assert.deepEqual(allowlistAus(null, praereg), ['fallzahl', 'auffindbarkeit']);

  const gut = path.join(verzeichnis, 'gut.json');
  fs.writeFileSync(gut, JSON.stringify(['klasse_a', 'klasse_b']), 'utf8');
  assert.deepEqual(allowlistAus(gut, praereg), ['klasse_a', 'klasse_b']);

  // Fail-closed: leer, kein Array, leerer Name, Dublette.
  for (const inhalt of ['[]', '{"a":1}', '["", "b"]', '["a","a"]']) {
    const schlecht = path.join(verzeichnis, 'schlecht.json');
    fs.writeFileSync(schlecht, inhalt, 'utf8');
    assert.throws(() => allowlistAus(schlecht, praereg), VerfassungsBruch,
      `Diese Allowlist haette abgewiesen werden muessen: ${inhalt}`);
  }
});

test('Die ausgegebene Allowlist ist genau die, die die Diagnose durchlaesst', () => {
  const lauf = diagnose(['--allowlist-ausgeben']);
  assert.equal(lauf.status, 0, lauf.stderr);
  const felder = JSON.parse(lauf.stdout);
  assert.ok(Array.isArray(felder) && felder.length > 0);
  // Die Klassen-Zaehler MUESSEN drin sein — sonst meldet die Diagnose etwas an,
  // das ihren eigenen Kern nicht deckt.
  for (const pflicht of ['klasse_a_keine_folgequartale', 'klasse_b_kennung_gewechselt',
    'klasse_c_zu_wenige_folgequartale', 'klasse_d_ohne_gewaehlte_reihe',
    'hypothetische_auffindbarkeit_anschlussfaehig', 'auffindbarkeit']) {
    assert.ok(felder.includes(pflicht), `Der Allowlist fehlt ${pflicht}`);
  }
  // Und nichts, was nach einem Messwert klingt.
  for (const feld of felder) {
    assert.ok(!/wachstum|umsatz|ergebnis_wert|kurs|rendite|persistenz/i.test(feld),
      `Der Allowlist-Eintrag ${feld} klingt nach einem Messwert, nicht nach einem Zaehler`);
  }
});
